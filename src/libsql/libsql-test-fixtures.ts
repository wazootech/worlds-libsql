import type { Client } from "@libsql/client";
import type { ConnectionDriver } from "@worlds/sdk/durable-backend";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import { initializeLibsqlSchema } from "./initialize-libsql-schema.ts";
import { LibsqlSchemaBuilder } from "./schema/libsql-schema-builder.ts";
import { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

export const testLibsqlSchemaBuilder = new LibsqlSchemaBuilder(32);
export const testLibsqlSearchQueryBuilder = new LibsqlSearchQueryBuilder(32);

/** sharedTextSplitter is the default text splitter for LibSQL search commit tests. */
export const sharedTextSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
});

/**
 * createTestLibsqlConnectionDriver wraps a raw LibSQL client in the
 * provider-seam ConnectionDriver for adapter tests.
 */
export function createTestLibsqlConnectionDriver(
  client: Client,
): LibsqlConnectionDriver {
  return new LibsqlConnectionDriver(client);
}

/**
 * setupLibsqlSchemaForTest initializes the LibSQL schema for adapter tests.
 */
export async function setupLibsqlSchemaForTest(
  connection: ConnectionDriver,
): Promise<void> {
  await initializeLibsqlSchema(connection, testLibsqlSchemaBuilder);
}
