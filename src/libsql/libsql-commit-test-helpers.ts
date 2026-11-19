import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { DataFactory } from "n3";
import { LibsqlQuadStore } from "@/libsql/quad-store/mod.ts";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import type { LibsqlConnectionDriver } from "@/libsql/libsql-connection-driver.ts";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

const { quad, namedNode, literal } = DataFactory;

/** BrokenChunkProjector emits a chunk statement the database rejects. */
export class BrokenChunkProjector extends LibsqlSearchIndexProjector {
  public override buildNovelQuadStatements(): Promise<never[]> {
    return Promise.resolve(
      ["INSERT INTO no_such_table VALUES (1)"] as never[],
    );
  }
}

export async function openDatabase() {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);
  return { client, connection };
}

export interface OpenStoreOptions {
  embeddingService?: EmbeddingService;
  mode?: "incremental" | "deferred" | "disabled";
  projector?: typeof LibsqlSearchIndexProjector;
  maxAtomicStatements?: number;
  maxWriteBatchSize?: number;
}

export function openStore(
  connection: LibsqlConnectionDriver,
  options: OpenStoreOptions = {},
) {
  const Projector = options.projector ?? LibsqlSearchIndexProjector;
  return new LibsqlQuadStore({
    connection,
    store: new LibsqlRdfjsStore({ connection, matchPageSize: 100 }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
    searchIndexProjector: new Projector({
      connection,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      embeddingService: options.embeddingService ?? new FakeEmbeddingService(),
    }),
    searchIndexOnImport: options.mode,
    maxAtomicStatements: options.maxAtomicStatements,
    maxWriteBatchSize: options.maxWriteBatchSize,
  });
}

export async function count(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(result.rows[0].n);
}

/**
 * recordBatches wraps client.batch and returns the statement count of every
 * call, in order. failOn(callNumber) (1-based) makes that call throw, as a
 * dropped Turso request would.
 */
export function recordBatches(
  client: Client,
  failOn?: (callNumber: number) => boolean,
): number[] {
  const sizes: number[] = [];
  const realBatch = client.batch.bind(client);
  client.batch = ((...args: Parameters<Client["batch"]>) => {
    sizes.push(args[0].length);
    if (failOn?.(sizes.length)) {
      throw new Error(`TURSO_FAIL_${sizes.length}`);
    }
    return realBatch(...args);
  }) as Client["batch"];
  return sizes;
}

export const fact = (id: string, text: string) =>
  quad(namedNode(`urn:s:${id}`), namedNode("urn:p"), literal(text));
