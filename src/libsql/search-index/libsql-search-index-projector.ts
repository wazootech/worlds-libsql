import type * as rdfjs from "@rdfjs/types";
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
   * projectNovelQuads processes new facts to project and index textual values.
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
