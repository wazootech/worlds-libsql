import type { InStatement } from "@libsql/client";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { SqlStatement } from "./libsql-connection-driver.ts";

/** DEFAULT_MAX_LOOKUP_CHUNK_SIZE is the default IN-clause and deletion chunk width. */
export const DEFAULT_MAX_LOOKUP_CHUNK_SIZE = 800;

/** DEFAULT_MAX_WRITE_BATCH_SIZE limits statements per LibSQL write batch. */
export const DEFAULT_MAX_WRITE_BATCH_SIZE = 500;

/** STAGING_FLUSH_THRESHOLD flushes staged SQL during large commits to avoid huge in-memory arrays. */
export const STAGING_FLUSH_THRESHOLD = 10_000;

/**
 * LibsqlBatchExecutorOptions defines the configuration for the batch executor.
 */
export interface LibsqlBatchExecutorOptions {
  /** connection is the LibsqlConnectionDriver used for executing writes. */
  connection: LibsqlConnectionDriver;

  /** writeBatchSize limits statements per LibSQL write batch. */
  writeBatchSize: number;
}

/**
 * normalizeToSqlStatement converts an @libsql/client InStatement to the
 * SqlStatement shape ({ sql, args?: unknown[] }). The executor stages only
 * parameterized positional-args statements; bare SQL strings are wrapped and
 * named-args records are unwrapped to their positional values.
 */
function normalizeToSqlStatement(statement: InStatement): SqlStatement {
  if (typeof statement === "string") {
    return { sql: statement };
  }
  const { sql, args } = statement;
  return {
    sql,
    args: args === undefined
      ? undefined
      : Array.isArray(args)
      ? args
      : Object.values(args),
  };
}

/**
 * LibsqlBatchExecutor encapsulates statement buffering and chunked execution for LibSQL.
 * It prevents memory blowouts by eagerly flushing when the staging buffer reaches the threshold.
 */
export class LibsqlBatchExecutor {
  private readonly statements: SqlStatement[] = [];

  public constructor(private readonly options: LibsqlBatchExecutorOptions) {}

  /**
   * stage appends statements and flushes eagerly when the staging buffer grows too large.
   */
  public async stage(source: readonly InStatement[]): Promise<void> {
    const sourceLength = source.length;
    for (let index = 0; index < sourceLength; index++) {
      this.statements.push(normalizeToSqlStatement(source[index]!));
      if (this.statements.length >= STAGING_FLUSH_THRESHOLD) {
        await this.flush();
      }
    }
  }

  /**
   * flush executes and clears all currently staged write statements.
   */
  public async flush(): Promise<void> {
    if (this.statements.length === 0) {
      return;
    }

    const { connection } = this.options;

    try {
      await connection.batch(this.statements);
    } finally {
      this.statements.length = 0;
    }
  }
}
