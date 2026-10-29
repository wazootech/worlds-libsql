import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@libsql/client";
import { LibsqlSearchIndex } from "./libsql-search-index.ts";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

// --- Tests ---
Deno.test("LibsqlSearchIndex - Tracer Bullet: performs basic hybrid search and maps results", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  const paddedVec = new Array(32).fill(0);
  paddedVec[0] = 1.0;
  const vecStr = JSON.stringify(paddedVec);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f1",
      "urn:alice",
      "urn:name",
      "urn:graph",
      "Alice is the explorer",
      "Alice is the explorer",
      vecStr,
    ],
  });

  const otherVec = [...paddedVec];
  otherVec[1] = 1.0;
  const otherVecStr = JSON.stringify(otherVec);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f2",
      "urn:bob",
      "urn:name",
      "urn:graph",
      "Bob stays back",
      "Bob stays back",
      otherVecStr,
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    connection,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const response = await searchIndex.search({ query: "Alice" });

  assertExists(response.results);
  const first = response.results[0];
  assertExists(first, "Expected at least one result.");
  assertEquals(first.subject, "urn:alice");
  assertEquals(first.predicate, "urn:name");
  assertEquals(first.text, "Alice is the explorer");
  assertEquals(typeof first.score, "number");
});

Deno.test("LibsqlSearchIndex - Scope Inclusion: limits matches only to included subjects", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  const data = new Array(32).fill(0);
  data[0] = 1.0;
  const vecStr = JSON.stringify(data);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f1",
      "urn:person:1",
      "urn:bio",
      "urn:g1",
      "Loves coding and data",
      "Loves coding and data",
      vecStr,
    ],
  });
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f2",
      "urn:person:2",
      "urn:bio",
      "urn:g1",
      "Loves coding and gardening",
      "Loves coding and gardening",
      vecStr,
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    connection,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const base = await searchIndex.search({ query: "coding" });
  assertEquals(
    base.results?.length,
    2,
    "Baseline should find both coding references",
  );

  const filtered = await searchIndex.search({
    query: "coding",
    include: {
      subjects: ["urn:person:2"],
    },
  });

  assertEquals(
    filtered.results?.length,
    1,
    "Should return exactly one filtered match",
  );
  assertEquals(filtered.results?.[0].subject, "urn:person:2");
});

Deno.test("LibsqlSearchIndex - Scope Exclusion: suppresses explicitly excluded predicates", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  const data = new Array(32).fill(0);
  data[0] = 1.0;
  const vecStr = JSON.stringify(data);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f1",
      "urn:e1",
      "urn:allowed",
      "urn:g",
      "Match text",
      "Match text",
      vecStr,
    ],
  });
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f2",
      "urn:e1",
      "urn:forbidden",
      "urn:g",
      "Match text",
      "Match text",
      vecStr,
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    connection,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const response = await searchIndex.search({
    query: "Match",
    exclude: {
      predicates: ["urn:forbidden"],
    },
  });

  assertEquals(
    response.results?.length,
    1,
    "Only non-excluded predicate should remain",
  );
  assertEquals(response.results?.[0].predicate, "urn:allowed");
});

Deno.test("LibsqlSearchIndex - Vectorless Mode: gracefully degrades to keyword-only search when embeddingService is omitted", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  // Insert chunk rows with NULL vectors (Vectorless mode)
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      "id-1",
      "urn:target",
      "urn:prop",
      "urn:g",
      "Specific search term inside target document",
      "Specific search term inside target document",
    ],
  });
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      "id-2",
      "urn:other",
      "urn:prop",
      "urn:g",
      "Completely unrelated keywords",
      "Completely unrelated keywords",
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    connection,
    // embeddingService is omitted intentionally to trigger Keyword-only FTS
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const response = await searchIndex.search({ query: "search term" });

  assertExists(response.results);
  assertEquals(
    response.results.length,
    1,
    "Should successfully locate exactly one record using raw FTS5",
  );
  assertEquals(response.results[0].subject, "urn:target");
  assertEquals(
    response.results[0].text,
    "Specific search term inside target document",
  );
});
