import type { TextSplitterInterface } from "@worlds/sdk/search-index/quad-chunker";
import type { LibsqlWorldsSdkBaseOptions } from "@/libsql/libsql-sdk-base-options.ts";
import type { LibsqlConnectionDriver } from "@/libsql/libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./libsql-search-query-builder.ts";

/** ProjectSearchChunksOptions are the collaborators chunking, embedding and rebuilding the search index need. */
export interface ProjectSearchChunksOptions extends LibsqlWorldsSdkBaseOptions {
  /** connection is the LibsqlConnectionDriver wrapping the LibSQL transport. */
  connection: LibsqlConnectionDriver;

  textSplitter: TextSplitterInterface;
  maxWriteBatchSize?: number;
  searchQueryBuilder: LibsqlSearchQueryBuilder;
}
