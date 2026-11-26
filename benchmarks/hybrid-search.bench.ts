import { bench, runBenches } from "./shared/bench.ts";
import { createClient } from "@libsql/client";
import { LibsqlSearchIndex } from "@/libsql/search-index/libsql-search-index.ts";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

class FailingEmbeddingService implements EmbeddingService {
  public embed(_texts: string[]): Promise<Array<Float32Array>> {
    return Promise.reject(
      new Error("Simulated network timeout/offline service."),
    );
  }
}

const databaseClient = createClient({ url: ":memory:" });
const connection = createTestLibsqlConnectionDriver(databaseClient);
await setupLibsqlSchemaForTest(connection);

const vectorArray = Array.from({ length: 32 }, () => 0);
vectorArray[0] = 1.0;
const vectorJsonString = JSON.stringify(vectorArray);

for (let index = 0; index < 1000; index++) {
  await databaseClient.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      `id-${index}`,
      `urn:entity:${index}`,
      "urn:property:name",
      "urn:graph:main",
      `Document payload text index ${index} with unique keywords.`,
      `Document payload text index ${index} with unique keywords.`,
      vectorJsonString,
    ],
  });
}

const ftsSearchIndex = new LibsqlSearchIndex({
  connection,
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
});

const hybridSearchIndex = new LibsqlSearchIndex({
  connection,
  embeddingService: new FakeEmbeddingService(),
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
});

const fallbackSearchIndex = new LibsqlSearchIndex({
  connection,
  embeddingService: new FailingEmbeddingService(),
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
});

bench({
  name: "Search: FTS5 Keyword-Only Search (Vectorless Mode)",
  group: "Hybrid Search Performance",
}, async () => {
  await ftsSearchIndex.search({ query: "unique keywords" });
});

bench({
  name: "Search: Hybrid RRF Fusion Search (Vector + FTS5)",
  group: "Hybrid Search Performance",
}, async () => {
  await hybridSearchIndex.search({ query: "unique keywords" });
});

bench({
  name: "Search: Graceful Degradation (Fallback to FTS5 on Error)",
  group: "Hybrid Search Performance",
}, async () => {
  await fallbackSearchIndex.search({ query: "unique keywords" });
});

await runBenches();
