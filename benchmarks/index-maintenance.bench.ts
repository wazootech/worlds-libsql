import { createClient } from "@libsql/client";
import { createLibsqlClient } from "@/libsql/mod.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "@/libsql/search-index/rebuild-libsql-search-index-from-quads.ts";
import { refreshSearchChunksForSubjects } from "@/libsql/search-index/refresh-search-chunks-for-subjects.ts";
import { FakeEmbeddingService } from "@worlds/client/search-index/embedding-service";
import {
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";
import { generateSyntheticQuads } from "./shared/synthetic-data.ts";

const databaseClient = createClient({ url: ":memory:" });
await setupLibsqlSchemaForTest(databaseClient);

const worldsClient = await createLibsqlClient({
  client: databaseClient,
  searchIndexOnImport: "disabled",
});

const sampleQuads = generateSyntheticQuads(1000);
await worldsClient.import({
  source: { kind: "quads", quads: sampleQuads },
});

const sampleSubjects = sampleQuads.map((quad) => quad.subject.value);

const maintenanceOptions = {
  client: databaseClient,
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
  embeddingService: new FakeEmbeddingService(),
  textSplitter: sharedTextSplitter,
};

Deno.bench({
  name: "Maintenance: Subject-scoped Refresh (100 Subjects)",
  group: "Index Maintenance",
  async fn(benchContext) {
    const subjectsToRefresh = sampleSubjects.slice(0, 100);

    benchContext.start();
    await refreshSearchChunksForSubjects(subjectsToRefresh, maintenanceOptions);
    benchContext.end();
  },
});

Deno.bench({
  name: "Maintenance: Full Index Rebuild (1,000 Quads)",
  group: "Index Maintenance",
  async fn(benchContext) {
    benchContext.start();
    await rebuildLibsqlSearchIndexFromQuads(maintenanceOptions);
    benchContext.end();
  },
});
