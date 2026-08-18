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

import type { LibsqlClientBaseOptions } from "./libsql-client-base-options.ts";
import { LibsqlRdfjsStore } from "./rdfjs-store/mod.ts";
import { initializeLibsqlSchema } from "./initialize-libsql-schema.ts";
import type { LibsqlSchemaBuilder } from "./schema/libsql-schema-builder.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

/**
 * LibsqlClientOptions configures LibSQL execution through the three
 * provider-seam strategy objects (worlds-sdk-ts#170): the factory no longer
 * constructs a schema or search-query builder internally — the caller supplies
 * them along with the ConnectionDriver, and the factory assembles the Sdk.
 */
export interface LibsqlClientOptions extends LibsqlClientBaseOptions {
  /** schema is the LibSQL dialect of the seam SchemaBuilder (tables + indexes + migrations). */
  schema: LibsqlSchemaBuilder;

  /** searchQuery is the LibSQL dialect of the seam SearchQueryBuilder (chunk/search SQL). */
  searchQuery: LibsqlSearchQueryBuilder;
}

/**
 * createLibsqlClient synthesizes a Sdk for LibsqlRdfjsStore quad indexes.
 */
export async function createLibsqlClient(
  options: LibsqlClientOptions,
): Promise<SdkInterface> {
  const { connection, schema, searchQuery } = options;

  await initializeLibsqlSchema(connection, schema);

  const textSplitter = options.textSplitter ??
    new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

  const searchIndex = new LibsqlSearchIndex({
    ...options,
    searchQueryBuilder: searchQuery,
    textSplitter,
  });

  const searchIndexProjector = new LibsqlSearchIndexProjector({
    ...options,
    searchQueryBuilder: searchQuery,
    textSplitter,
  });

  const libsqlRdfjsStore = new LibsqlRdfjsStore({
    connection,
    matchPageSize: options.matchPageSize,
  });

  const quadStore = new LibsqlQuadStore({
    ...options,
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
