import type { Patch, TransactionContext } from "@worlds/sdk/quad-store";
import { commitSqlPatch } from "@worlds/sqlite/sql-core";
import type { LibsqlWorldsSdkBaseOptions } from "@/libsql/libsql-sdk-base-options.ts";
import {
  createLibsqlCommitDriver,
  createLibsqlDialect,
  LIBSQL_REBUILD_PAGE_SIZE,
} from "./libsql-sql-commit.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";
import type { LibsqlSearchIndexProjector } from "./search-index/libsql-search-index-projector.ts";

export interface CommitPatchToLibsqlOptions extends LibsqlWorldsSdkBaseOptions {
  /** connection is the LibsqlConnectionDriver wrapping the LibSQL transport. */
  connection: LibsqlConnectionDriver;

  /**
   * maxAtomicStatements is the largest commit written as one atomic batch
   * (default 10,000). Above it the commit is written in non-atomic batches of
   * maxWriteBatchSize with cleanup; see writeCommitStatements in
   * `@worlds/sqlite/sql-core` for the contract.
   */
  maxAtomicStatements?: number;

  /** maxWriteBatchSize is the statements per batch once a commit exceeds maxAtomicStatements (default 500). */
  maxWriteBatchSize?: number;

  /** searchQueryBuilder supplies dimension-aware SQL used for deletions, inserts, and chunk replication. */
  searchQueryBuilder: LibsqlSearchQueryBuilder;

  /** searchIndexProjector supplies the chunking and embedding configuration; without it no chunks are written. */
  searchIndexProjector?: LibsqlSearchIndexProjector;
}

/**
 * commitPatchToLibsql commits a patch and its search-index chunk rows by
 * running the shared `commitSqlPatch` core (`@worlds/sqlite/sql-core`) with the
 * LibSQL driver and dialect. Chunking and embedding happen before any write, so
 * an embedding failure writes nothing; the write is one atomic LibSQL batch up
 * to maxAtomicStatements, then chunked with cleanup. A deferred import ends
 * with the core's full search-index rebuild.
 */
export async function commitPatchToLibsql(
  patch: Patch,
  options: CommitPatchToLibsqlOptions,
  context?: TransactionContext,
): Promise<void> {
  await commitSqlPatch(
    patch,
    context,
    createLibsqlCommitDriver(options),
    createLibsqlDialect(options),
    {
      filter: { include: options.include, exclude: options.exclude },
      searchIndexOnImport: options.searchIndexOnImport,
      projection: options.searchIndexProjector?.projectionOptions,
      rebuildPageSize: LIBSQL_REBUILD_PAGE_SIZE,
    },
  );
}
