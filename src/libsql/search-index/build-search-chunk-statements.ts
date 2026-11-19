import type { InStatement } from "@libsql/client";
import type {
  ChunkRowPayload,
  TextSplitterInterface,
} from "@worlds/sdk/search-index/quad-chunker";
import { chunkQuads } from "@worlds/sdk/search-index/quad-chunker";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import type * as rdfjs from "@rdfjs/types";
import { buildChunkFtsValue } from "@worlds/sqlite/sql-core";
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
 * buildSearchChunkStatements chunks and embeds quads and returns the chunk
 * INSERT statements without executing them. Chunking and embedding are async
 * and may call external services, so callers run this before opening a write
 * and put the returned statements in the same atomic batch as the quad rows.
 */
export async function buildSearchChunkStatements(
  quads: rdfjs.Quad[],
  quadIds: string[],
  options: BuildSearchChunkStatementsOptions,
): Promise<InStatement[]> {
  const statements: InStatement[] = [];

  let chunks: ChunkRowPayload[];
  try {
    chunks = await chunkQuads(quads, options.textSplitter, quadIds);
  } catch (cause) {
    throw new Error("failed to chunk novel textual facts", { cause });
  }

  if (chunks.length === 0) {
    return [];
  }

  const chunksWithFtsValue = chunks.map((chunk) => ({
    chunk,
    fts_value: buildChunkFtsValue(chunk),
  }));

  let vectorLookupMap: Map<string, Float32Array | number[]> | undefined;

  if (options.embeddingService) {
    const uniqueTexts = Array.from(
      new Set(
        chunksWithFtsValue.flatMap(({ chunk, fts_value }) => [
          fts_value,
          chunk.value,
        ]),
      ),
    );
    let uniqueVectors: Array<Float32Array | number[]>;
    try {
      uniqueVectors = await options.embeddingService.embed(uniqueTexts);
      for (
        let vectorIndex = 0;
        vectorIndex < uniqueVectors.length;
        vectorIndex++
      ) {
        const projectedVector = uniqueVectors[vectorIndex]!;
        const embeddingLength = projectedVector.length;
        if (embeddingLength !== options.searchQueryBuilder.vectorDimensions) {
          throw new Error(
            `embedding length ${embeddingLength} does not match configured vectorDimensions ${options.searchQueryBuilder.vectorDimensions}`,
          );
        }
      }
    } catch (cause) {
      throw new Error("failed to vectorize literal chunk blocks", { cause });
    }

    vectorLookupMap = new Map<string, Float32Array | number[]>();
    for (let textIndex = 0; textIndex < uniqueTexts.length; textIndex++) {
      vectorLookupMap.set(uniqueTexts[textIndex], uniqueVectors[textIndex]!);
    }
  }

  for (const { chunk, fts_value } of chunksWithFtsValue) {
    const vector = vectorLookupMap?.get(fts_value);
    const vectorJson = vector ? JSON.stringify(Array.from(vector)) : undefined;

    statements.push(
      options.searchQueryBuilder.buildInsertChunk({
        quad_id: chunk.quad_id,
        subject: chunk.subject,
        predicate: chunk.predicate,
        graph: chunk.graph,
        value: chunk.value,
        fts_value,
        vectorJson,
      }),
    );
  }

  return statements;
}
