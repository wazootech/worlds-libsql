import { createClient } from "@libsql/client";
import { createLibsqlSdk } from "@/libsql/mod.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "@/libsql/search-index/rebuild-libsql-search-index-from-quads.ts";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";
import { generateSyntheticQuads } from "./shared/synthetic-data.ts";

const databaseClient = createClient({ url: ":memory:" });
const connection = createTestLibsqlConnectionDriver(databaseClient);
await setupLibsqlSchemaForTest(connection);

const worldsClient = await createLibsqlSdk({
  client: databaseClient,
  searchIndexOnImport: "disabled",
});

const sampleQuads = generateSyntheticQuads(1000);
await worldsClient.import({
  source: { kind: "quads", quads: sampleQuads },
});

const maintenanceOptions = {
  connection,
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
  embeddingService: new FakeEmbeddingService(),
  textSplitter: sharedTextSplitter,
};

Deno.bench({
  name: "Maintenance: Full Index Rebuild (1,000 Quads)",
  group: "Index Maintenance",
  async fn(benchContext) {
    benchContext.start();
    await rebuildLibsqlSearchIndexFromQuads(maintenanceOptions);
    benchContext.end();
  },
});
