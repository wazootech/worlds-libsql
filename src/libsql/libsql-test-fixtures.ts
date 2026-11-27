import assert from "node:assert/strict";
import type { Client } from "@libsql/client";
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
 * createTestLibsqlConnectionDriver wraps a raw LibSQL client in a
 * LibsqlConnectionDriver for adapter tests.
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
  connection: LibsqlConnectionDriver,
): Promise<void> {
  await initializeLibsqlSchema(connection, testLibsqlSchemaBuilder);
}

type ErrorClass<T extends Error> = abstract new (...args: never[]) => T;

/**
 * rejected awaits the promise `callback` returns and returns its rejection,
 * after checking it is an instance of `errorClass` (default `Error`) and, when
 * given, that its message includes `messageIncludes`. It stands in for the
 * value-returning `assertRejects` of `@std/assert`, built on `node:assert` so
 * the same tests run on Deno and Bun.
 */
export async function rejected<T extends Error = Error>(
  callback: () => Promise<unknown>,
  errorClass?: ErrorClass<T>,
  messageIncludes?: string,
): Promise<T> {
  let caught: unknown;
  let didReject = false;
  try {
    await callback();
  } catch (error) {
    didReject = true;
    caught = error;
  }
  assert.ok(didReject, "Expected function to reject");
  assert.ok(
    caught instanceof (errorClass ?? Error),
    `Expected error to be an instance of ${(errorClass ?? Error).name}`,
  );
  const error = caught as T;
  if (messageIncludes !== undefined) {
    assert.ok(
      error.message.includes(messageIncludes),
      `Expected error message to include "${messageIncludes}": ${error.message}`,
    );
  }
  return error;
}
