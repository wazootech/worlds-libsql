import { rebuildSqlSearchIndexWithCounts } from "@worlds/sqlite/sql-core";
import {
  createLibsqlCommitDriver,
  createLibsqlDialect,
  LIBSQL_REBUILD_PAGE_SIZE,
} from "@/libsql/libsql-sql-commit.ts";
import { libsqlProjectionOptions } from "./build-search-chunk-statements.ts";
import type { ProjectSearchChunksOptions } from "./project-search-chunks.ts";

/**
 * RebuildLibsqlSearchIndexFromQuadsResult reports how many quads and chunk rows were processed.
 */
export interface RebuildLibsqlSearchIndexFromQuadsResult {
  /** processedQuadCount is the number of quads read from durable storage. */
  processedQuadCount: number;
  /** chunkRowCount is the number of chunk rows written to FTS/vector tables. */
  chunkRowCount: number;
}

export interface ReadProjectSearchChunksOptions extends ProjectSearchChunksOptions {
  readPageSize?: number;
}

/**
 * rebuildLibsqlSearchIndexFromQuads rebuilds FTS and vector chunk rows from the `quads` table without re-importing graph data.
 *
 * It runs the shared `rebuildSqlSearchIndexWithCounts` from `@worlds/sqlite/sql-core`. Without `include`/`exclude` it clears every chunk row just before the first page is written; with either set it clears nothing and replaces only the chunk rows of the matching quads. Chunking and embedding happen before each write, so an embedding failure on the first page changes nothing; a failure on a later page leaves earlier pages indexed and a rerun repairs it.
 *
 * Use after schema upgrades, label predicate changes, or discovery-index tuning so existing corpora pick up refreshed `fts_value` and vectors.
 */
export async function rebuildLibsqlSearchIndexFromQuads(
  options: ReadProjectSearchChunksOptions,
): Promise<RebuildLibsqlSearchIndexFromQuadsResult> {
  const { include, exclude, readPageSize } = options;
  // The driver is unfiltered: the scope belongs to the rebuild, so
  // processedQuadCount counts every quad scanned, in scope or not.
  const sqlOptions = {
    connection: options.connection,
    searchQueryBuilder: options.searchQueryBuilder,
    maxWriteBatchSize: options.maxWriteBatchSize,
    maxLookupChunkSize: options.maxLookupChunkSize,
  };
  return await rebuildSqlSearchIndexWithCounts(
    createLibsqlCommitDriver(sqlOptions),
    createLibsqlDialect(sqlOptions),
    libsqlProjectionOptions(options),
    {
      pageSize: Math.max(
        1,
        Math.floor(readPageSize ?? LIBSQL_REBUILD_PAGE_SIZE),
      ),
      scope: { include, exclude },
    },
  );
}

/**
 * createLibsqlSearchIndexRebuilder returns a closure that rebuilds search chunks using stable LibSQL dependencies.
 */
export function createLibsqlSearchIndexRebuilder(
  dependencies: ProjectSearchChunksOptions & { readPageSize?: number },
): () => Promise<RebuildLibsqlSearchIndexFromQuadsResult> {
  return () => rebuildLibsqlSearchIndexFromQuads(dependencies);
}
