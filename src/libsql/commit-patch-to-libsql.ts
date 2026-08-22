import type { InStatement } from "@libsql/client";
import type * as rdfjs from "@rdfjs/types";
import type { Patch, TransactionContext } from "@worlds/sdk/quad-store";
import { isReplaceImportCommit } from "@worlds/sdk/quad-store";
import { filterQuads, fromRdfjsTerm, hashQuads } from "@worlds/sdk/quad-store";
import type { LibsqlWorldsSdkBaseOptions } from "@/libsql/libsql-sdk-base-options.ts";
import {
  buildBulkInsertQuads,
  buildDeleteQuadsByQuadIds,
  buildSelectExistingQuadIds,
  buildWipeAllGraphDataStatements,
} from "./quad-store/libsql-quad-query-builder.ts";
import { LibsqlBatchExecutor } from "./libsql-batch-executor.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

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

/**
 * buildDeletionStatements constructs parameterized deletion statements sweeping facts and vector bounds.
 */
function buildDeletionStatements(
  quadIds: string[],
  queryBuilder: LibsqlSearchQueryBuilder,
): InStatement[] {
  return [
    queryBuilder.buildDeleteByQuadIds(quadIds),
    buildDeleteQuadsByQuadIds(quadIds),
  ];
}

/**
 * stageDeletionStatementsChunked slices large quad id sets and eagerly streams them to the executor.
 */
export async function stageDeletionStatementsChunked(
  executor: LibsqlBatchExecutor,
  quadIds: string[],
  queryBuilder: LibsqlSearchQueryBuilder,
  chunkSize: number,
): Promise<void> {
  for (let index = 0; index < quadIds.length; index += chunkSize) {
    const quadIdBatch = quadIds.slice(index, index + chunkSize);
    await executor.stage(buildDeletionStatements(quadIdBatch, queryBuilder));
  }
}

/**
 * queryCachePresence polls SQLite to check which Quad IDs have already been fully vectorized and indexed.
 */
async function queryCachePresence(
  connection: LibsqlConnectionDriver,
  quadIds: string[],
  lookupChunkSize: number,
): Promise<Set<string>> {
  const cachedIds = new Set<string>();
  try {
    for (let i = 0; i < quadIds.length; i += lookupChunkSize) {
      const batchIds = quadIds.slice(i, i + lookupChunkSize);
      const query = buildSelectExistingQuadIds(batchIds);
      const resultSet = await connection.execute(query);
      for (const row of resultSet.rows) {
        if (row.id) {
          cachedIds.add(String(row.id));
        }
      }
    }
  } catch (cause) {
    throw new Error("failed to query existing cache state", { cause });
  }

  return cachedIds;
}

/**
 * buildRelationalStatements decomposes structured Triples into raw SQLite relational columns.
 */
function buildRelationalStatements(
  quads: rdfjs.Quad[],
  quadIds: string[],
): InStatement[] {
  const insertQuadRows = quads.map((quad, index) => {
    const subject = fromRdfjsTerm(quad.subject);
    const object = fromRdfjsTerm(quad.object);
    const graph = fromRdfjsTerm(quad.graph);

    return {
      quad_id: quadIds[index],
      s: subject.value,
      s_type: subject.termType,
      p: quad.predicate.value,
      o: object.value,
      o_type: object.termType,
      o_datatype: object.datatype,
      o_lang: object.language,
      g: graph.value,
      g_type: graph.termType,
    };
  });

  return buildBulkInsertQuads(insertQuadRows);
}
