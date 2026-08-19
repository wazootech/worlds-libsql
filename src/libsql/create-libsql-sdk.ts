import type { Client as LibsqlClient } from "@libsql/client";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type * as rdfjs from "@rdfjs/types";
import { Sdk } from "@worlds/sdk";
import type { SdkInterface } from "@worlds/sdk";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import {
  LibsqlSearchIndex,
  LibsqlSearchIndexProjector,
} from "@/libsql/search-index/mod.ts";
import { LibsqlQuadStore } from "./quad-store/mod.ts";

import type { LibsqlSdkBaseOptions } from "./libsql-sdk-base-options.ts";
import { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import { LibsqlRdfjsStore } from "./rdfjs-store/mod.ts";
import { initializeLibsqlSchema } from "./initialize-libsql-schema.ts";
import { LibsqlSchemaBuilder } from "./schema/libsql-schema-builder.ts";
import { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

/**
 * LibsqlSdkOptions configures LibSQL execution through LibsqlRdfjsStore and quad indexes.
 */
export interface LibsqlSdkOptions extends LibsqlSdkBaseOptions {
  /** client is the underlying LibSQL client pointing to the database. */
  client: LibsqlClient;
}

/**
 * createLibsqlSdk synthesizes a Sdk for LibsqlRdfjsStore quad indexes.
 *
 * The factory assembles the three strategy objects internally: a
 * LibsqlConnectionDriver over the raw client, a LibsqlSchemaBuilder, and a
 * LibsqlSearchQueryBuilder. Callers pass the plain LibSQL client.
 */
export async function createLibsqlSdk(
  options: LibsqlSdkOptions,
): Promise<SdkInterface> {
  const vectorDimensions = options.vectorDimensions ?? 32;
  const connection = new LibsqlConnectionDriver(options.client);
  const schema = new LibsqlSchemaBuilder(vectorDimensions);
  const searchQuery = new LibsqlSearchQueryBuilder(vectorDimensions);

  await initializeLibsqlSchema(connection, schema);

  const textSplitter = options.textSplitter ??
    new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

  const searchIndex = new LibsqlSearchIndex({
    ...options,
    connection,
    searchQueryBuilder: searchQuery,
    textSplitter,
  });

  const searchIndexProjector = new LibsqlSearchIndexProjector({
    ...options,
    connection,
    searchQueryBuilder: searchQuery,
    textSplitter,
  });

  const libsqlRdfjsStore = new LibsqlRdfjsStore({
    connection,
    matchPageSize: options.matchPageSize,
  });

  const quadStore = new LibsqlQuadStore({
    ...options,
    connection,
    store: libsqlRdfjsStore,
    searchQueryBuilder: searchQuery,
    searchIndexProjector,
  });

  const sparqlEngine = new WazooSparqlEngine({
    store: libsqlRdfjsStore as unknown as rdfjs.Store,
    createTransaction: () => quadStore.createTransaction(),
  });

  return new Sdk({
    quadStore,
    searchIndex,
    sparqlEngine,
  });
}
