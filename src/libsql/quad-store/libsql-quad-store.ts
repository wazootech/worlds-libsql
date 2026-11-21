import type * as rdfjs from "@rdfjs/types";
import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
  QuadStoreInterface,
} from "@worlds/sdk/quad-store";
import {
  exportFromRdfjsStore,
  importViaTransaction,
  Transaction,
} from "@worlds/sdk/quad-store";
import type { LibsqlWorldsSdkBaseOptions } from "../libsql-sdk-base-options.ts";
import type { LibsqlConnectionDriver } from "../libsql-connection-driver.ts";
import type { LibsqlRdfjsStore } from "../rdfjs-store/mod.ts";
import type { LibsqlSearchQueryBuilder } from "../search-index/libsql-search-query-builder.ts";
import type { LibsqlSearchIndexProjector } from "../search-index/mod.ts";
import { commitPatchToLibsql } from "../commit-patch-to-libsql.ts";

/**
 * LibsqlQuadStoreOptions defines the configurations for the LibsqlQuadStore.
 */
export interface LibsqlQuadStoreOptions extends LibsqlWorldsSdkBaseOptions {
  /** connection is the LibsqlConnectionDriver wrapping the LibSQL transport. */
  connection: LibsqlConnectionDriver;

  /** store is the underlying LibSQL RDF/JS ReadSource store. */
  store: LibsqlRdfjsStore;

  /** searchQueryBuilder supplies dimension-aware SQL used for deletions, inserts, and chunk replication. */
  searchQueryBuilder: LibsqlSearchQueryBuilder;

  /** searchIndexProjector manages vector embedding and text chunk synchronisation. */
  searchIndexProjector?: LibsqlSearchIndexProjector;

  /**
   * maxAtomicStatements is the largest commit (statements, including search
   * chunk rows) written as one atomic batch. Defaults to 10,000, the largest
   * batch the previous implementation sent. Larger commits are not atomic.
   */
  maxAtomicStatements?: number;

  /** maxWriteBatchSize is how many statements go in each batch once a commit exceeds maxAtomicStatements. Defaults to 500. */
  maxWriteBatchSize?: number;
}

/**
 * LibsqlQuadStore implements the QuadStoreInterface for LibSQL backed durable persistence.
 * It encapsulates transaction routing, commits, and indexing synchronization.
 */
export class LibsqlQuadStore implements QuadStoreInterface {
  public constructor(
    private readonly options: LibsqlQuadStoreOptions,
  ) {}

  /**
   * import merges or replaces the underlying store with provided RDF source data.
   *
   * @param request The payload defining the ingestion source and overwrite mode.
   */
  public async import(request: ImportRequest): Promise<void> {
    await importViaTransaction(request, {
      createTransaction: () => this.createTransaction(),
    });
  }

  /**
   * export extracts the graph contents in raw quads or serialized formats.
   *
   * @param request The desired format specifications.
   */
  public async export(request: ExportRequest): Promise<ExportResponse> {
    return await exportFromRdfjsStore(
      this.options.store as unknown as rdfjs.Store,
      request,
    );
  }

  /**
   * createTransaction returns a Transaction whose commit writes the patch and its
   * search-index chunk rows as one atomic batch (see commitPatchToLibsql), so a
   * failed projection or write leaves neither quads nor chunks behind. Commits
   * above maxAtomicStatements are written in chunks instead: not atomic, with
   * the novel quads deleted again if a later chunk fails.
   *
   * With searchIndexOnImport "deferred", an import writes only quads and then
   * rebuilds the whole index in a separate pass (the shared core's rebuild); if that pass fails, the quads are
   * kept and the caller can run reindex() again.
   */
  public createTransaction(): Transaction {
    return new Transaction({
      commit: (patch, context) =>
        commitPatchToLibsql(patch, this.options, context),
    });
  }
}
