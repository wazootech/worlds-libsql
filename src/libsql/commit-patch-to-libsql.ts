import type * as rdfjs from "@rdfjs/types";
import type { Patch, TransactionContext } from "@worlds/sdk/quad-store";
import { isReplaceImportCommit } from "@worlds/sdk/quad-store";
import { filterQuads, hashQuads } from "@worlds/sdk/quad-store";
import type { LibsqlWorldsSdkBaseOptions } from "@/libsql/libsql-sdk-base-options.ts";
import {
  buildWipeAllGraphDataStatements,
} from "./quad-store/libsql-quad-query-builder.ts";
import { LibsqlBatchExecutor } from "./libsql-batch-executor.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";
import {
  buildRelationalStatements,
  queryCachePresence,
  stageDeletionStatementsChunked,
} from "./commit-patch-to-libsql-helpers.ts";

export { stageDeletionStatementsChunked };

export interface CommitPatchToLibsqlOptions extends LibsqlWorldsSdkBaseOptions {
  /** connection is the LibsqlConnectionDriver wrapping the LibSQL transport. */
  connection: LibsqlConnectionDriver;

  /** maxWriteBatchSize caps how many statements are sent per LibSQL write batch. Defaults to 500. */
  maxWriteBatchSize?: number;

  /** searchQueryBuilder supplies dimension-aware SQL used for deletions, inserts, and chunk replication. */
  searchQueryBuilder: LibsqlSearchQueryBuilder;
}

export interface CommitPatchToLibsqlResult {
  novelInsertions: rdfjs.Quad[];
  novelQuadIds: string[];
}

/**
 * executeReplaceImportWipe clears all quads and search chunks before a replace-mode import commit.
 */
async function executeReplaceImportWipe(
  connection: LibsqlConnectionDriver,
  writeBatchSize: number,
): Promise<void> {
  const executor = new LibsqlBatchExecutor({ connection, writeBatchSize });
  await executor.stage(buildWipeAllGraphDataStatements());
  await executor.flush();
}

/**
 * commitPatchToLibsql commits additions and removals exclusively for LibSQL quads.
 * It returns the novel insertions and touched subjects to be processed by independent search projection.
 */
export async function commitPatchToLibsql(
  patch: Patch,
  options: CommitPatchToLibsqlOptions,
  context?: TransactionContext,
): Promise<CommitPatchToLibsqlResult> {
  const {
    connection,
    maxLookupChunkSize,
    maxWriteBatchSize,
    include,
    exclude,
    searchQueryBuilder,
  } = options;
  const lookupChunkSize = maxLookupChunkSize ?? 800; // default lookup chunk size
  const writeBatchSize = maxWriteBatchSize ?? 500; // default write batch size

  const batchExecutor = new LibsqlBatchExecutor({ connection, writeBatchSize });

  if (isReplaceImportCommit(context)) {
    await executeReplaceImportWipe(
      connection,
      writeBatchSize,
    );
  }

  const matcher = filterQuads({ include, exclude });

  const targetedDeletions = patch.deletions?.filter(matcher) ?? [];
  const targetedInsertions = patch.insertions?.filter(matcher) ?? [];

  // 1. Stage Sweeping Deletion Operations
  const deletionQuadIds = new Set<string>();
  if (targetedDeletions.length) {
    const computedDeletionQuadIds = await hashQuads(targetedDeletions);
    for (const quadId of computedDeletionQuadIds) {
      deletionQuadIds.add(quadId);
    }
    if (computedDeletionQuadIds.length > 0) {
      await stageDeletionStatementsChunked(
        batchExecutor,
        computedDeletionQuadIds,
        searchQueryBuilder,
        lookupChunkSize,
      );
    }
  }

  // 2. Stage Content-Addressed Novel Insertion Operations
  const novelInsertions: rdfjs.Quad[] = [];
  const novelQuadIds: string[] = [];

  if (targetedInsertions.length) {
    const proposedQuadIds = await hashQuads(targetedInsertions);
    const existingIds = await queryCachePresence(
      connection,
      proposedQuadIds,
      lookupChunkSize,
    );

    // Deduplication Filter: Process ONLY truly novel facts that are not yet persistent
    for (let i = 0; i < targetedInsertions.length; i++) {
      const id = proposedQuadIds[i];
      if (!existingIds.has(id) || deletionQuadIds.has(id)) {
        novelInsertions.push(targetedInsertions[i]);
        novelQuadIds.push(id);
      }
    }

    if (novelQuadIds.length > 0) {
      // Ensure relational clean slate for new items
      await stageDeletionStatementsChunked(
        batchExecutor,
        novelQuadIds,
        searchQueryBuilder,
        lookupChunkSize,
      );

      // Stage Fact Decompositions (Relational Index)
      await batchExecutor.stage(
        buildRelationalStatements(
          novelInsertions,
          novelQuadIds,
        ),
      );
    }
  }

  // 3. Flush any remaining staged writes
  try {
    await batchExecutor.flush();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`failed to execute sync batch: ${detail}`, { cause });
  }

  return {
    novelInsertions,
    novelQuadIds,
  };
}
