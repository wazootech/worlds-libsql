import type { Client, InStatement } from "@libsql/client";
import type {
  ConnectionDriver,
  SqlExecutor,
  SqlResult,
  SqlStatement,
} from "@worlds/sdk/durable-backend";

/**
 * LibsqlConnectionDriver adapts an @libsql/client Client to the provider-seam
 * ConnectionDriver (worlds-sdk-ts#170): a uniform SQL surface (execute /
 * batch / transaction / close) over the LibSQL transport (remote Turso or
 * embedded local file). The LibSQL factory and its stores execute through this
 * driver instead of touching the raw client.
 */
export class LibsqlConnectionDriver implements ConnectionDriver {
  public constructor(private readonly client: Client) {}

  /**
   * execute runs a single parameterized statement and returns its rows.
   */
  public async execute<Row = Record<string, unknown>>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>> {
    const result = await this.client.execute(statement as InStatement);
    return { rows: result.rows as Row[] };
  }

  /**
   * batch runs multiple write statements in one LibSQL write transaction.
   */
  public async batch(statements: readonly SqlStatement[]): Promise<void> {
    await this.client.batch(statements as InStatement[], "write");
  }

  /**
   * transaction runs the given function inside an atomic write transaction
   * (@libsql/client 0.17 exposes interactive transactions, not callbacks).
   */
  public async transaction<T>(
    fn: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    const tx = await this.client.transaction("write");
    try {
      const result = await fn(tx as unknown as SqlExecutor);
      await tx.commit();
      return result;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {
        // Transaction already closed; preserve the original error.
      }
      throw error;
    }
  }

  /**
   * close releases the underlying LibSQL client.
   */
  public close(): Promise<void> {
    return Promise.resolve(this.client.close());
  }
}
