import type {
  ReindexRequest,
  ReindexResponse,
  SearchIndexInterface,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "@worlds/client/search-index";
import { buildSearchResultId } from "./build-search-result-id.ts";
import type { LibsqlClientBaseOptions } from "@/libsql/libsql-client-base-options.ts";
import type { LibsqlSearchQueryBuilder } from "./libsql-search-query-builder.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "./rebuild-libsql-search-index-from-quads.ts";

/**
 * SearchRequestWithProfile extends SearchRequest with memory profile overrides for topK and minScore.
 * These fields will be added to the upstream SearchRequest interface in a future release.
 */
interface SearchRequestWithProfile extends SearchRequest {
  topK?: number;
  minScore?: number;
}

/**
 * LibsqlSearchIndexOptions defines the structured configuration and dependency parameters needed to construct the LibSQL search engine.
 */
export interface LibsqlSearchIndexOptions extends LibsqlClientBaseOptions {
  /** searchQueryBuilder must match the schema and commit path used when materializing chunk vectors. */
  searchQueryBuilder: LibsqlSearchQueryBuilder;

  /** limit establishes optional page sizing constraints for search result sets, defaulting to 100. */
  limit?: number;

  /** maxWriteBatchSize caps statements per LibSQL batch during reindex (default 500). */
  maxWriteBatchSize?: number;
}

/**
 * LibsqlSearchIndex implements only the query pathway, performing sub-millisecond hybrid search.
 */
export class LibsqlSearchIndex implements SearchIndexInterface {
  public constructor(
    private readonly options: LibsqlSearchIndexOptions,
  ) {}

  /**
   * search executes a keyword and vector hybrid query against the current index.
   */
  public async search(request: SearchRequest): Promise<SearchResponse> {
    const profileRequest = request as SearchRequestWithProfile;
    let vectorJson: string | undefined;

    if (this.options.embeddingService) {
      try {
        const [vector] = await this.options.embeddingService.embed([
          request.query,
        ]);
        const embeddingLength = vector.length;
        if (
          embeddingLength !== this.options.searchQueryBuilder.vectorDimensions
        ) {
          throw new Error(
            `query embedding length ${embeddingLength} does not match vectorDimensions ${this.options.searchQueryBuilder.vectorDimensions}`,
          );
        }
        vectorJson = JSON.stringify(Array.from(vector));
      } catch (error) {
        // Gracefully degrade to keyword-only search if the embedding service fails.
        console.warn(
          `[Search Warning] Embedding service failure. Degrading to keyword-only search fallback. Reason: ${
            (error as Error).message
          }`,
        );
      }
    }

    const searchLimit = profileRequest.topK ?? this.options.limit ?? 100;

    const { sql, args } = this.options.searchQueryBuilder.buildSearchQuery(
      request,
      {
        vectorJson,
        limit: searchLimit,
      },
    );

    const resultSet = await this.options.client.execute({ sql, args });

    const minScore = profileRequest.minScore ?? 0;
    const results: SearchResult[] = [];

    for (const row of resultSet.rows) {
      const score = Number(row["combined_rank"]);
      if (score < minScore) continue;

      const searchResultBase = {
        subject: String(row["subject"]),
        predicate: String(row["predicate"]),
        graph: String(row["graph"]),
        text: String(row["value"]),
      };
      results.push({
        id: await buildSearchResultId(searchResultBase),
        ...searchResultBase,
        score,
      });
    }

    return { results };
  }

  /**
   * reindex rebuilds FTS/vector chunk rows from durable quads without re-importing graph data.
   */
  public async reindex(
    request?: ReindexRequest,
  ): Promise<ReindexResponse> {
    const textSplitter = this.options.textSplitter;
    if (!textSplitter) {
      throw new Error(
        "LibsqlSearchIndex reindex requires textSplitter in LibsqlSearchIndexOptions",
      );
    }

    const include = request?.include ?? this.options.include;
    const exclude = request?.exclude ?? this.options.exclude;

    return await rebuildLibsqlSearchIndexFromQuads({
      ...this.options,
      textSplitter,
      include,
      exclude,
      readPageSize: request?.readPageSize,
    });
  }
}
