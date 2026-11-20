import type { InStatement } from "@libsql/client";
import type { Patch, TransactionContext } from "@worlds/sdk/quad-store";
import {
  isReplaceImportCommit,
  preparePatch,
  selectNovelQuads,
} from "@worlds/sdk/quad-store";
import { planSearchIndexing } from "@worlds/sdk/search-index";
import type { LibsqlWorldsSdkBaseOptions } from "@/libsql/libsql-sdk-base-options.ts";
import { buildWipeAllGraphDataStatements } from "./quad-store/libsql-quad-query-builder.ts";
import {
  buildDeletionStatementsChunked,
  buildRelationalStatements,
  queryCachePresence,
} from "./commit-patch-statements.ts";
import { writeCommitStatements } from "./commit-patch-write.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";
import type { LibsqlSearchIndexProjector } from "./search-index/libsql-search-index-projector.ts";

export interface CommitPatchToLibsqlOptions extends LibsqlWorldsSdkBaseOptions {
  /** connection is the LibsqlConnectionDriver wrapping the LibSQL transport. */
  connection: LibsqlConnectionDriver;

  /**
   * maxAtomicStatements is the largest commit written as one atomic batch
   * (default 10,000, the largest batch the previous implementation sent). Above
   * it the commit is written in non-atomic batches of maxWriteBatchSize; see
   * writeCommitStatements for the cleanup contract.
   */
  maxAtomicStatements?: number;

  /** maxWriteBatchSize is the statements per batch once a commit exceeds maxAtomicStatements (default 500). */
  maxWriteBatchSize?: number;

  /** searchQueryBuilder supplies dimension-aware SQL used for deletions, inserts, and chunk replication. */
  searchQueryBuilder: LibsqlSearchQueryBuilder;

  /** searchIndexProjector builds the FTS/vector chunk rows written in the same batch as the quads. */
  searchIndexProjector?: LibsqlSearchIndexProjector;
}

/**
 * commitPatchToLibsql commits a patch and its search-index chunk rows. The
 * optional replace-import wipe, deletions, quad inserts, and FTS/vector chunk
 * inserts go in a single atomic LibSQL batch when they fit within
 * maxAtomicStatements; larger commits are chunked and not atomic (see
 * writeCommitStatements). Reads (which quads are new) and the async chunking
 * and embedding happen first, so a failure there writes nothing.
 */
export async function commitPatchToLibsql(
  patch: Patch,
  options: CommitPatchToLibsqlOptions,
  context?: TransactionContext,
): Promise<void> {
  const { connection, maxLookupChunkSize, include, exclude } = options;
  const lookupChunkSize = maxLookupChunkSize ?? 800; // default lookup chunk size
  const statements: InStatement[] = [];
  const replacing = isReplaceImportCommit(context);

  if (replacing) {
    statements.push(...buildWipeAllGraphDataStatements());
  }

  // 1. Sweeping deletions
  const prepared = preparePatch(patch, { include, exclude });
  if (prepared.deletionIds.length) {
    statements.push(
      ...buildDeletionStatementsChunked(
        prepared.deletionIds,
        options.searchQueryBuilder,
        lookupChunkSize,
      ),
    );
  }

  // 2. Content-addressed novel insertions: only facts that are not yet
  // persistent (or are deleted and re-added here). A replace import wipes
  // everything in this same batch, so nothing existing counts as cached.
  const { novelInsertions, novelQuadIds } = await selectNovelQuads(prepared, {
    replacing,
    lookupExisting: (ids) =>
      queryCachePresence(connection, ids, lookupChunkSize),
  });

  if (novelQuadIds.length > 0) {
    // Relational clean slate for new items, then fact decompositions.
    statements.push(
      ...buildDeletionStatementsChunked(
        novelQuadIds,
        options.searchQueryBuilder,
        lookupChunkSize,
      ),
      ...buildRelationalStatements(novelInsertions, novelQuadIds),
    );

    // 3. Search chunks: chunk and embed now (may call an external service), write below.
    const projector = options.searchIndexProjector;
    if (
      projector &&
      planSearchIndexing(options.searchIndexOnImport, context)
        .projectDuringCommit
    ) {
      statements.push(
        ...await projector.buildNovelQuadStatements(
          novelInsertions,
          novelQuadIds,
        ),
      );
    }
  }

  // 4. Write: one atomic batch, or chunked batches with cleanup for very large commits
  if (statements.length === 0) return;
  await writeCommitStatements(statements, novelQuadIds, options);
}
