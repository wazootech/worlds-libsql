import type { InStatement } from "@libsql/client";
import type {
  ChunkRowPayload,
  TextSplitterInterface,
} from "@worlds/sdk/search-index/quad-chunker";
import { chunkQuads } from "@worlds/sdk/search-index/quad-chunker";
import type * as rdfjs from "@rdfjs/types";
import { hashQuads } from "@worlds/sdk/quad-store";
import type { LibsqlWorldsSdkBaseOptions } from "@/libsql/libsql-sdk-base-options.ts";
import type { LibsqlConnectionDriver } from "@/libsql/libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./libsql-search-query-builder.ts";

import { buildChunkFtsValue } from "./search-chunk-fts.ts";
import { LibsqlBatchExecutor } from "@/libsql/libsql-batch-executor.ts";

export interface ProjectSearchChunksOptions extends LibsqlWorldsSdkBaseOptions {
  /** connection is the LibsqlConnectionDriver wrapping the LibSQL transport. */
  connection: LibsqlConnectionDriver;

  textSplitter: TextSplitterInterface;
  maxWriteBatchSize?: number;
  searchQueryBuilder: LibsqlSearchQueryBuilder;
}

/**
 * projectSearchChunks processes novel quads to create, embed, and store FTS/vector chunks.
 */
export async function projectSearchChunks(
  novelInsertions: rdfjs.Quad[],
  novelQuadIds: string[],
  options: ProjectSearchChunksOptions,
): Promise<void> {
  const chunkStatements = await buildVectorChunkStatements(
    novelInsertions,
    novelQuadIds,
    options,
  );

  if (chunkStatements.length > 0) {
    const writeBatchSize = options.maxWriteBatchSize ?? 500;
    try {
      const executor = new LibsqlBatchExecutor({
        connection: options.connection,
        writeBatchSize,
      });
      await executor.stage(chunkStatements);
      await executor.flush();
    } catch (cause) {
      throw new Error("failed to execute search chunk sync batch", { cause });
    }
  }
}

/**
 * refreshSearchChunksForQuads deletes existing chunk rows for the given quads and rebuilds FTS/vector projections.
 * Durable `quads` rows are not modified. Returns the number of chunk rows written.
 */
export async function refreshSearchChunksForQuads(
  quads: rdfjs.Quad[],
  options: ProjectSearchChunksOptions,
): Promise<number> {
  if (quads.length === 0) {
    return 0;
  }

  const lookupChunkSize = options.maxLookupChunkSize ?? 800;
  const writeBatchSize = options.maxWriteBatchSize ?? 500;

  const quadIds = await hashQuads(quads);
  const chunkInsertStatements = await buildVectorChunkStatements(
    quads,
    quadIds,
    options,
  );

  const executor = new LibsqlBatchExecutor({
    connection: options.connection,
    writeBatchSize,
  });

  try {
    await executor.stage(
      buildChunkDeletionStatementsChunked(
        quadIds,
        options.searchQueryBuilder,
        lookupChunkSize,
      ),
    );
    await executor.stage(chunkInsertStatements);
    await executor.flush();
  } catch (cause) {
    throw new Error("failed to refresh search chunks", { cause });
  }

  return chunkInsertStatements.length;
}

function buildChunkDeletionStatementsChunked(
  quadIds: string[],
  queryBuilder: LibsqlSearchQueryBuilder,
  chunkSize: number,
): InStatement[] {
  const statements: InStatement[] = [];
  for (let index = 0; index < quadIds.length; index += chunkSize) {
    const quadIdBatch = quadIds.slice(index, index + chunkSize);
    statements.push(
      queryBuilder.buildDeleteByQuadIds(quadIdBatch),
    );
  }
  return statements;
}

async function buildVectorChunkStatements(
  quads: rdfjs.Quad[],
  quadIds: string[],
  options: ProjectSearchChunksOptions,
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
