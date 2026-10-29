import { assertEquals } from "@std/assert";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";

import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";
import { createLibsqlPersistHooks } from "./commit-patch-to-libsql-test-helpers.ts";
const { quad, namedNode, literal } = DataFactory;

Deno.test(
  "createLibsqlPersistHooks - bulk quad INSERT persists expected quads row count",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const bulkQuadCount = 120;
    const bulkQuads = Array.from({ length: bulkQuadCount }, (_, index) =>
      quad(
        namedNode(`urn:subject:${index}`),
        namedNode("urn:predicate"),
        literal(`bulk insert ${index}`),
      ));

    const persistHooks = createLibsqlPersistHooks({
      connection,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        connection,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "disabled",
    });

    await persistHooks.commit({ insertions: bulkQuads, deletions: [] });

    const quadRows = await client.execute(
      "SELECT COUNT(*) as total FROM quads",
    );
    assertEquals(Number(quadRows.rows[0].total), bulkQuadCount);
  },
);

Deno.test("createLibsqlPersistHooks - isolated writes and removals commit correctly to BOTH chunks and quads", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  const persistHooks = createLibsqlPersistHooks({
    connection,
    embeddingService: new FakeEmbeddingService(),
    searchIndexProjector: new LibsqlSearchIndexProjector({
      connection,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      embeddingService: new FakeEmbeddingService(),
    }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const testQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("Content for synchronization tests"),
  );

  // 1. Commit insertion
  await persistHooks.commit({
    insertions: [testQuad],
    deletions: [],
  });

  // 2. Verify both Tables updated
  let chunkRows = await client.execute("SELECT COUNT(*) as total FROM chunks");
  assertEquals(
    chunkRows.rows[0].total,
    1,
    "Expected one chunk written to index",
  );

  let quadRows = await client.execute("SELECT COUNT(*) as total FROM quads");
  assertEquals(
    quadRows.rows[0].total,
    1,
    "Expected exact master quad record replicated",
  );

  // 3. Execute deletion
  await persistHooks.commit({
    insertions: [],
    deletions: [testQuad],
  });

  // 4. Verify holistic cleared state
  chunkRows = await client.execute("SELECT COUNT(*) as total FROM chunks");
  assertEquals(chunkRows.rows[0].total, 0, "Index cleanup failed");

  quadRows = await client.execute("SELECT COUNT(*) as total FROM quads");
  assertEquals(quadRows.rows[0].total, 0, "Master quad cleanup failed");
});

Deno.test("createLibsqlPersistHooks - supports synchronization when embeddingService is omitted (vector column left null)", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  const persistHooks = createLibsqlPersistHooks({
    connection,
    // embeddingService is omitted intentionally
    searchIndexProjector: new LibsqlSearchIndexProjector({
      connection,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const testQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("Vectorless searchable text node"),
  );

  // Commit insertion
  await persistHooks.commit({
    insertions: [testQuad],
    deletions: [],
  });

  // Verify that the chunk table has the row but with vector null
  const chunkRows = await client.execute("SELECT value, vector FROM chunks");
  assertEquals(
    chunkRows.rows.length,
    1,
    "Expected one chunk written to standard FTS index",
  );
  assertEquals(chunkRows.rows[0].value, "Vectorless searchable text node");
  assertEquals(
    chunkRows.rows[0].vector,
    null,
    "The vector data should remain null due to omitted adapter",
  );

  // Confirm parent quad still inserted
  const quadRows = await client.execute("SELECT COUNT(*) as total FROM quads");
  assertEquals(quadRows.rows[0].total, 1);
});

Deno.test("createLibsqlPersistHooks - stores object value as fts_value", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  const persistHooks = createLibsqlPersistHooks({
    connection,
    embeddingService: new FakeEmbeddingService(),
    searchIndexProjector: new LibsqlSearchIndexProjector({
      connection,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      embeddingService: new FakeEmbeddingService(),
    }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const testQuad = quad(
    namedNode("http://example.org/Aurelia"),
    namedNode("http://example.org/hasCapital"),
    literal("Lume"),
  );

  await persistHooks.commit({
    insertions: [testQuad],
    deletions: [],
  });

  const chunkRows = await client.execute(
    "SELECT value, fts_value FROM chunks",
  );
  assertEquals(chunkRows.rows.length, 1);
  assertEquals(chunkRows.rows[0].value, "Lume");
  assertEquals(
    chunkRows.rows[0].fts_value,
    "Lume",
    "fts_value must index the object value only",
  );
});
