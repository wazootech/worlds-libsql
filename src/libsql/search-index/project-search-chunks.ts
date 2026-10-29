import type * as rdfjs from "@rdfjs/types";
import { hashQuads } from "@worlds/sdk/quad-store";
import { LibsqlBatchExecutor } from "@/libsql/libsql-batch-executor.ts";
import {
  buildChunkDeletionStatementsChunked,
  buildVectorChunkStatements,
} from "./project-search-chunks-statements.ts";
import type { ProjectSearchChunksOptions } from "./project-search-chunks-statements.ts";

export type { ProjectSearchChunksOptions };

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
