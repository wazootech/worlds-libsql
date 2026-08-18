import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type * as rdfjs from "@rdfjs/types";
import { Client } from "@worlds/sdk";
import type { ClientInterface } from "@worlds/sdk";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import {
  LibsqlSearchIndex,
  LibsqlSearchIndexProjector,
} from "@/libsql/search-index/mod.ts";
import { LibsqlQuadStore } from "./quad-store/mod.ts";

import type { LibsqlClientBaseOptions } from "./libsql-client-base-options.ts";
import { LibsqlRdfjsStore } from "./rdfjs-store/mod.ts";
import { initializeLibsqlSchema } from "./initialize-libsql-schema.ts";
import { LibsqlSchemaBuilder } from "./schema/libsql-schema-builder.ts";
import { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

/**
 * LibsqlClientOptions configures LibSQL execution through LibsqlRdfjsStore and quad indexes.
 */
export interface LibsqlClientOptions extends LibsqlClientBaseOptions {}

/**
 * createLibsqlClient synthesizes a Client for LibsqlRdfjsStore quad indexes.
 */
export async function createLibsqlClient(
  options: LibsqlClientOptions,
): Promise<ClientInterface> {
  const vectorDimensions = options.vectorDimensions ?? 32;
  const schemaBuilder = new LibsqlSchemaBuilder(vectorDimensions);
  const searchQueryBuilder = new LibsqlSearchQueryBuilder(vectorDimensions);

  await initializeLibsqlSchema(options.client, schemaBuilder);

  const textSplitter = options.textSplitter ??
    new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

  const searchIndex = new LibsqlSearchIndex({
    ...options,
    searchQueryBuilder,
    textSplitter,
  });

  const searchIndexProjector = new LibsqlSearchIndexProjector({
    ...options,
    searchQueryBuilder,
    textSplitter,
  });

  const libsqlRdfjsStore = new LibsqlRdfjsStore({
    client: options.client,
    matchPageSize: options.matchPageSize,
  });

  const quadStore = new LibsqlQuadStore({
    ...options,
    store: libsqlRdfjsStore,
    searchQueryBuilder,
    searchIndexProjector,
  });

  const sparqlEngine = new WazooSparqlEngine({
    store: libsqlRdfjsStore as unknown as rdfjs.Store,
    createTransaction: () => quadStore.createTransaction(),
  });

  return new Client({
    quadStore,
    searchIndex,
    sparqlEngine,
  });
}
