import type { InStatement } from "@libsql/client";
import type {
  EmbeddedChunk,
  TextSplitterInterface,
} from "@worlds/sdk/search-index/quad-chunker";
import { chunkAndEmbedQuads } from "@worlds/sdk/search-index/quad-chunker";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import type * as rdfjs from "@rdfjs/types";
import { buildChunkFtsValue } from "@worlds/sqlite/sql-core";
import type { SqlProjectionOptions } from "@worlds/sqlite/sql-core";
import type { LibsqlSearchQueryBuilder } from "./libsql-search-query-builder.ts";

/**
 * BuildSearchChunkStatementsOptions is what chunking and embedding need; it is
 * a subset of ProjectSearchChunksOptions, so those options satisfy it.
 */
export interface BuildSearchChunkStatementsOptions {
  textSplitter: TextSplitterInterface;
  embeddingService?: EmbeddingService;
  searchQueryBuilder: LibsqlSearchQueryBuilder;
}

/**
 * libsqlProjectionOptions is the chunking and embedding configuration LibSQL
 * hands to the shared commit core and to chunkAndEmbedQuads.
 */
export function libsqlProjectionOptions(
  options: BuildSearchChunkStatementsOptions,
): SqlProjectionOptions {
  return {
    textSplitter: options.textSplitter,
    embeddingService: options.embeddingService,
    ftsValueOf: buildChunkFtsValue,
    vectorDimensions: options.searchQueryBuilder.vectorDimensions,
  };
}

/** buildChunkRowStatement is the LibSQL INSERT for one embedded chunk row. */
export function buildChunkRowStatement(
  queryBuilder: LibsqlSearchQueryBuilder,
  { chunk, ftsValue, vector }: EmbeddedChunk,
): InStatement {
  return queryBuilder.buildInsertChunk({
    quad_id: chunk.quad_id,
    subject: chunk.subject,
    predicate: chunk.predicate,
    graph: chunk.graph,
    value: chunk.value,
    fts_value: ftsValue,
    vectorJson: vector ? JSON.stringify(Array.from(vector)) : undefined,
  });
}

/**
 * buildSearchChunkStatements chunks and embeds quads and returns the chunk
 * INSERT statements without executing them. Chunking and embedding are async
 * and may call external services, so callers run this before opening a write.
 * Chunking and embedding are the shared chunkAndEmbedQuads from @worlds/sdk;
 * only the LibSQL INSERT statements are built here.
 */
export async function buildSearchChunkStatements(
  quads: rdfjs.Quad[],
  quadIds: string[],
  options: BuildSearchChunkStatementsOptions,
): Promise<InStatement[]> {
  const { rows } = await chunkAndEmbedQuads(
    quads,
    quadIds,
    libsqlProjectionOptions(options),
  );
  return rows.map((row) =>
    buildChunkRowStatement(options.searchQueryBuilder, row)
  );
}
