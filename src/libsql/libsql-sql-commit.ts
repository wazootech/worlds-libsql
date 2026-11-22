import type { InStatement } from "@libsql/client";
import type { SqlCommitDriver, SqlDialect } from "@worlds/sqlite/sql-core";
import {
  DEFAULT_MAX_ATOMIC_STATEMENTS,
  DEFAULT_WRITE_BATCH_SIZE,
} from "@worlds/sqlite/sql-core";
import { filterQuads } from "@worlds/sdk/quad-store";
import type { QuadFilter } from "@worlds/sdk/quad-store";
import {
  buildChunkDeletionStatementsChunked,
  buildDeletionStatementsChunked,
  buildRelationalStatements,
  queryCachePresence,
} from "./commit-patch-statements.ts";
import { normalizeToSqlStatement } from "./libsql-batch-executor.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import { quadFromLibsqlRow } from "./libsql-quad-row.ts";
import {
  buildMatchQuadsQuery,
  buildWipeAllGraphDataStatements,
  DEFAULT_LIBSQL_MATCH_PAGE_SIZE,
} from "./quad-store/libsql-quad-query-builder.ts";
import { buildChunkRowStatement } from "./search-index/build-search-chunk-statements.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

/** LibsqlSqlCommitOptions are the LibSQL-specific limits and collaborators of the shared SQL commit core. */
export interface LibsqlSqlCommitOptions extends QuadFilter {
  connection: LibsqlConnectionDriver;
  searchQueryBuilder: LibsqlSearchQueryBuilder;
  /** maxAtomicStatements is the largest commit written as one atomic batch (default 10,000). */
  maxAtomicStatements?: number;
  /** maxWriteBatchSize is the statements per batch above that limit (default 500). */
  maxWriteBatchSize?: number;
  /** maxLookupChunkSize is the ids per IN clause (default 800). */
  maxLookupChunkSize?: number;
}

/** LIBSQL_REBUILD_PAGE_SIZE is the quads per page of a full rebuild (the match page size). */
export const LIBSQL_REBUILD_PAGE_SIZE = DEFAULT_LIBSQL_MATCH_PAGE_SIZE;

function syncBatchError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`failed to execute sync batch: ${detail}`, { cause });
}

/** createLibsqlCommitDriver is the thin LibSQL execution surface the shared core runs against. */
export function createLibsqlCommitDriver(
  options: LibsqlSqlCommitOptions,
): SqlCommitDriver<InStatement> {
  const { connection, include, exclude } = options;
  const matches = filterQuads({ include, exclude });
  return {
    maxAtomicStatements: options.maxAtomicStatements ??
      DEFAULT_MAX_ATOMIC_STATEMENTS,
    writeBatchSize: options.maxWriteBatchSize ?? DEFAULT_WRITE_BATCH_SIZE,
    async executeBatch(statements) {
      try {
        await connection.batch(statements.map(normalizeToSqlStatement));
      } catch (cause) {
        throw syncBatchError(cause);
      }
    },
    lookupExisting: (ids) =>
      queryCachePresence(connection, ids, options.maxLookupChunkSize ?? 800),
    async streamQuads({ after, pageSize }) {
      const { rows } = await connection.execute(buildMatchQuadsQuery(
        { subject: null, predicate: null, object: null, graph: null },
        { afterQuadId: after as string | undefined, limit: pageSize },
      ));
      const quads = [];
      for (const row of rows) {
        try {
          const quad = quadFromLibsqlRow(row);
          if (matches(quad)) quads.push(quad);
        } catch (error) {
          console.warn(`skipping corrupt row s="${row.s}"`, error);
        }
      }
      const last = rows.at(-1);
      return {
        quads,
        next: last && rows.length >= pageSize ? String(last.id) : undefined,
      };
    },
  };
}

/** createLibsqlDialect builds LibSQL statements from the shared core's decisions. */
export function createLibsqlDialect(
  options: LibsqlSqlCommitOptions,
): SqlDialect<InStatement> {
  const { searchQueryBuilder, maxLookupChunkSize = 800 } = options;
  const deletions = (ids: string[]) =>
    buildDeletionStatementsChunked(ids, searchQueryBuilder, maxLookupChunkSize);
  return {
    keyOf: (_quad, hash) => hash,
    buildWipe: buildWipeAllGraphDataStatements,
    buildClearChunks: () => [{ sql: "DELETE FROM chunks", args: [] }],
    buildDeleteChunks: (hashes) =>
      buildChunkDeletionStatementsChunked(
        hashes,
        searchQueryBuilder,
        maxLookupChunkSize,
      ),
    buildDeletions: (keys) => deletions(keys),
    buildInserts: (quads, _keys, hashes) =>
      buildRelationalStatements(quads, hashes),
    buildChunkRows: (rows) =>
      rows.map((row) => buildChunkRowStatement(searchQueryBuilder, row)),
    buildCleanup: (keys) => deletions(keys),
  };
}
