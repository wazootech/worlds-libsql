import type { SqlProjectionOptions } from "@worlds/sqlite/sql-core";
import { libsqlProjectionOptions } from "./build-search-chunk-statements.ts";
import type { ProjectSearchChunksOptions } from "./project-search-chunks.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "./rebuild-libsql-search-index-from-quads.ts";

export interface LibsqlSearchIndexProjectorOptions extends ProjectSearchChunksOptions {
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

  /** projectionOptions is the chunking and embedding configuration the shared SQL commit core runs with. */
  public get projectionOptions(): SqlProjectionOptions {
    return libsqlProjectionOptions(this.options);
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
