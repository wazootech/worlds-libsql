import type { InStatement } from "@libsql/client";
import type * as rdfjs from "@rdfjs/types";
import type { Patch, TransactionContext } from "@worlds/sdk/quad-store";
import { isReplaceImportCommit } from "@worlds/sdk/quad-store";
import { filterQuads, hashQuads } from "@worlds/sdk/quad-store";
import type { LibsqlWorldsSdkBaseOptions } from "@/libsql/libsql-sdk-base-options.ts";
import { buildWipeAllGraphDataStatements } from "./quad-store/libsql-quad-query-builder.ts";
import {
  buildDeletionStatementsChunked,
  buildRelationalStatements,
  queryCachePresence,
} from "./commit-patch-statements.ts";
import { normalizeToSqlStatement } from "./libsql-batch-executor.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";
import type { LibsqlSearchIndexProjector } from "./search-index/libsql-search-index-projector.ts";
import { projectsDuringCommit } from "./search-index/search-index-mode.ts";

export interface CommitPatchToLibsqlOptions extends LibsqlWorldsSdkBaseOptions {
  /** connection is the LibsqlConnectionDriver wrapping the LibSQL transport. */
  connection: LibsqlConnectionDriver;

  /** maxWriteBatchSize is accepted for compatibility; a commit is always one atomic batch. */
  maxWriteBatchSize?: number;

  /** searchQueryBuilder supplies dimension-aware SQL used for deletions, inserts, and chunk replication. */
  searchQueryBuilder: LibsqlSearchQueryBuilder;

  /** searchIndexProjector builds the FTS/vector chunk rows written in the same batch as the quads. */
  searchIndexProjector?: LibsqlSearchIndexProjector;
}

/**
 * commitPatchToLibsql commits a patch and its search-index chunk rows as one
 * atomic write: the optional replace-import wipe, deletions, quad inserts, and
 * FTS/vector chunk inserts all go in a single LibSQL batch, which commits or
 * rolls back as a whole. Reads (which quads are new) and the async chunking and
 * embedding happen first, so a failure there writes nothing.
 */
export async function commitPatchToLibsql(
  patch: Patch,
  options: CommitPatchToLibsqlOptions,
  context?: TransactionContext,
): Promise<void> {
  const { connection, maxLookupChunkSize, include, exclude } = options;
  const lookupChunkSize = maxLookupChunkSize ?? 800; // default lookup chunk size
  const matcher = filterQuads({ include, exclude });
  const statements: InStatement[] = [];
  const replacing = isReplaceImportCommit(context);

  if (replacing) {
    statements.push(...buildWipeAllGraphDataStatements());
  }

  const targetedDeletions = patch.deletions?.filter(matcher) ?? [];
  const targetedInsertions = patch.insertions?.filter(matcher) ?? [];

  // 1. Sweeping deletions
  const deletionQuadIds = new Set<string>();
  if (targetedDeletions.length) {
    const computedDeletionQuadIds = await hashQuads(targetedDeletions);
    for (const quadId of computedDeletionQuadIds) {
      deletionQuadIds.add(quadId);
    }
    statements.push(
      ...buildDeletionStatementsChunked(
        computedDeletionQuadIds,
        options.searchQueryBuilder,
        lookupChunkSize,
      ),
    );
  }

  // 2. Content-addressed novel insertions
  const novelInsertions: rdfjs.Quad[] = [];
  const novelQuadIds: string[] = [];

  if (targetedInsertions.length) {
    const proposedQuadIds = await hashQuads(targetedInsertions);
    // A replace import wipes everything in this same batch, so nothing existing counts as cached.
    const existingIds = replacing
      ? new Set<string>()
      : await queryCachePresence(connection, proposedQuadIds, lookupChunkSize);

    // Deduplication filter: only facts that are not yet persistent (or are deleted and re-added here)
    for (let i = 0; i < targetedInsertions.length; i++) {
      const id = proposedQuadIds[i];
      if (!existingIds.has(id) || deletionQuadIds.has(id)) {
        novelInsertions.push(targetedInsertions[i]);
        novelQuadIds.push(id);
      }
    }
  }

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
      projector && projectsDuringCommit(options.searchIndexOnImport, context)
    ) {
      statements.push(
        ...await projector.buildNovelQuadStatements(
          novelInsertions,
          novelQuadIds,
        ),
      );
    }
  }

  // 4. One atomic write
  if (statements.length === 0) return;
  try {
    await connection.batch(statements.map(normalizeToSqlStatement));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`failed to execute sync batch: ${detail}`, { cause });
  }
}
