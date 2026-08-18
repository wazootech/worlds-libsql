import type { ConnectionDriver } from "@worlds/sdk/durable-backend";
import type { QuadFilter } from "@worlds/sdk/quad-store";
import type { SearchIndexOnImport } from "@worlds/sdk/search-index";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import type { TextSplitterInterface } from "@worlds/sdk/search-index/quad-chunker";

/**
 * LibsqlClientBaseOptions lists configuration shared by quad index LibSQL client factories.
 */
export interface LibsqlClientBaseOptions extends QuadFilter {
  /**
   * connection is the provider-seam ConnectionDriver wrapping the underlying
   * LibSQL transport (worlds-sdk-ts#170). Stores and the factory execute
   * through it instead of touching the raw @libsql/client.
   */
  connection: ConnectionDriver;

  /** embeddingService is an optional service projected for transforming text literals into comparison vectors. */
  embeddingService?: EmbeddingService;

  /** textSplitter is an optional custom text splitting facility, defaults to sensible character-based splitting. */
  textSplitter?: TextSplitterInterface;

  /** maxLookupChunkSize specifies the maximum number of host parameters allowed in cache query IN clauses before split-chunking. Defaults to a conservative 800 (safely below historical SQLite 999 SQLITE_MAX_VARIABLE_NUMBER variable caps with generous headroom). */
  maxLookupChunkSize?: number;

  /**
   * matchPageSize limits rows per LibsqlRdfjsStore.match SQL round-trip on reads (default 1000).
   */
  matchPageSize?: number;

  /**
   * labelPredicates extends built-in label IRIs used for subject alias discovery (union, deduped).
   */
  labelPredicates?: string[];

  /**
   * searchIndexOnImport controls when FTS/vector chunk projection runs during import.
   *
   * - `"incremental"` (default when omitted): chunks each quad on commit.
   * - `"deferred"`: persists quads on each import, rebuilds FTS/vector chunks in one pass afterward.
   * - `"disabled"`: skips chunking entirely; caller calls `client.reindex()` before searching.
   */
  searchIndexOnImport?: SearchIndexOnImport;
}
