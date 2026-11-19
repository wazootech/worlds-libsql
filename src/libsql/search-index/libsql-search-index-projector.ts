import type { InStatement } from "@libsql/client";
import type * as rdfjs from "@rdfjs/types";
import { buildSearchChunkStatements } from "./build-search-chunk-statements.ts";
import type { ProjectSearchChunksOptions } from "./project-search-chunks.ts";
import { projectSearchChunks } from "./project-search-chunks.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "./rebuild-libsql-search-index-from-quads.ts";

export interface LibsqlSearchIndexProjectorOptions
  extends ProjectSearchChunksOptions {
  // Currently, options are exactly ProjectSearchChunksOptions.
}

/**
 * LibsqlSearchIndexProjector encapsulates hybrid search projection operations.
 * It manages vector embedding, FTS chunk generation, and indexing synchronization
 * decoupled from the primary quad storage path.
 */
export class LibsqlSearchIndexProjector {
  public constructor(
    private readonly options: LibsqlSearchIndexProjectorOptions,
  ) {}

  /**
   * buildNovelQuadStatements chunks and embeds new facts and returns the FTS/vector
   * chunk INSERT statements without executing them. LibsqlQuadStore writes them in
   * the same atomic batch as the quad rows, so a failure here (for example in the
   * embedding service) happens before anything is written.
   */
  public async buildNovelQuadStatements(
    novelInsertions: rdfjs.Quad[],
    novelQuadIds: string[],
  ): Promise<InStatement[]> {
    if (novelQuadIds.length === 0) return [];
    return await buildSearchChunkStatements(
      novelInsertions,
      novelQuadIds,
      this.options,
    );
  }

  /**
   * projectNovelQuads projects new facts and writes their chunk rows in its own
   * batch. It is not atomic with the quad write; LibsqlQuadStore does not use it
   * and calls buildNovelQuadStatements instead.
   */
  public async projectNovelQuads(
    novelInsertions: rdfjs.Quad[],
    novelQuadIds: string[],
  ): Promise<void> {
    if (novelQuadIds.length > 0) {
      await projectSearchChunks(
        novelInsertions,
        novelQuadIds,
        this.options,
      );
    }
  }

  /**
   * reindexAll rebuilds the entire search index directly from durable quads.
   */
  public async reindexAll(): Promise<void> {
    await rebuildLibsqlSearchIndexFromQuads({
      ...this.options,
    });
  }
}
