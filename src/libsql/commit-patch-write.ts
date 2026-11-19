import type { InStatement } from "@libsql/client";
import { buildDeletionStatementsChunked } from "./commit-patch-statements.ts";
import { normalizeToSqlStatement } from "./libsql-batch-executor.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { SqlStatement } from "./libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

/**
 * DEFAULT_MAX_ATOMIC_STATEMENTS is the largest commit written as one atomic
 * batch. It equals the largest single batch the previous implementation ever
 * sent (it flushed every 10,000 statements), so no commit sends a bigger
 * request than before and every commit that used to be one batch stays atomic.
 */
export const DEFAULT_MAX_ATOMIC_STATEMENTS = 10_000;

/** DEFAULT_WRITE_BATCH_SIZE is the statements-per-batch default for the chunked fallback. */
const DEFAULT_WRITE_BATCH_SIZE = 500;

export interface CommitWriteOptions {
  connection: LibsqlConnectionDriver;
  searchQueryBuilder: LibsqlSearchQueryBuilder;
  /** maxAtomicStatements is the largest commit written as one atomic batch. Defaults to 10,000. */
  maxAtomicStatements?: number;
  /** maxWriteBatchSize is the statements per batch when a commit exceeds maxAtomicStatements. Defaults to 500. */
  maxWriteBatchSize?: number;
  maxLookupChunkSize?: number;
}

function syncBatchError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`failed to execute sync batch: ${detail}`, { cause });
}

async function writeInBatches(
  connection: LibsqlConnectionDriver,
  statements: SqlStatement[],
  size: number,
  onBatchCommitted?: () => void,
): Promise<void> {
  for (let start = 0; start < statements.length; start += size) {
    await connection.batch(statements.slice(start, start + size));
    onBatchCommitted?.();
  }
}

/**
 * writeCommitStatements writes a commit's statements.
 *
 * Up to maxAtomicStatements they go in one batch that commits or rolls back as
 * a whole. Above that they are written in batches of maxWriteBatchSize, which
 * is NOT atomic: if a later batch fails, earlier batches stay committed, so the
 * novel quads (and their chunks) written so far are deleted again. That cleanup
 * cannot restore deletions or a replace-import wipe that an earlier batch
 * already applied. If the cleanup also fails, an AggregateError carrying both
 * errors is thrown and the quads and search index may be left inconsistent.
 */
export async function writeCommitStatements(
  statements: InStatement[],
  novelQuadIds: string[],
  options: CommitWriteOptions,
): Promise<void> {
  const { connection } = options;
  const sql = statements.map(normalizeToSqlStatement);
  const maxAtomic = options.maxAtomicStatements ??
    DEFAULT_MAX_ATOMIC_STATEMENTS;

  if (sql.length <= maxAtomic) {
    try {
      await connection.batch(sql);
    } catch (cause) {
      throw syncBatchError(cause);
    }
    return;
  }

  const size = Math.max(
    1,
    options.maxWriteBatchSize ?? DEFAULT_WRITE_BATCH_SIZE,
  );
  let committedBatches = 0;
  try {
    await writeInBatches(connection, sql, size, () => committedBatches++);
  } catch (cause) {
    const failure = syncBatchError(cause);
    // The first batch is atomic, so a failure there wrote nothing.
    if (committedBatches === 0) throw failure;
    try {
      const cleanup = buildDeletionStatementsChunked(
        novelQuadIds,
        options.searchQueryBuilder,
        options.maxLookupChunkSize ?? 800,
      ).map(normalizeToSqlStatement);
      await writeInBatches(connection, cleanup, size);
    } catch (cleanupCause) {
      throw new AggregateError(
        [failure, cleanupCause],
        "commit failed and cleaning up its partial write also failed; quads and search index may be inconsistent",
      );
    }
    throw failure;
  }
}
