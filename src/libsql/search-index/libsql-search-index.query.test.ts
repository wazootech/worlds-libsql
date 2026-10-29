import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@libsql/client";
import { LibsqlSearchIndex } from "./libsql-search-index.ts";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

// --- Tests ---
Deno.test("LibsqlSearchIndex - Stability: executes search safely when query contains special FTS5 syntax characters without throwing crashes", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  // Insert a document we can try to find
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      "id-1",
      "urn:subject",
      "urn:prop",
      "urn:g",
      'The magic phrase with "quotes"',
      'The magic phrase with "quotes"',
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    connection,
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  // RED EXPECTATION: Running a query containing unclosed special characters (", {, etc.)
  // will crash SQLite during parsing unless sanitized.
  const dangerousQueries = [
    'magic "phrase"', // unclosed quotes within phrase
    '"hello', // starting lone quote
    "{ unclosed", // unclosed bracket
    "foo* bar", // asterisk suffix
  ];

  for (const query of dangerousQueries) {
    // This should NOT throw an error!
    const response = await searchIndex.search({ query });

    // Assert that it gracefully completes search without raising SQL exceptions
    assertExists(response.results, `Failed on query: ${query}`);
  }
});

/** FailingEmbeddingService always rejects embed() to exercise keyword fallback. */
class FailingEmbeddingService implements EmbeddingService {
  public embed(_texts: string[]): Promise<Array<Float32Array>> {
    return Promise.reject(new Error("embedding service unavailable"));
  }
}

/** WrongDimensionEmbeddingService returns vectors with an invalid width. */
class WrongDimensionEmbeddingService implements EmbeddingService {
  public embed(texts: string[]): Promise<Array<Float32Array>> {
    return Promise.resolve(texts.map(() => new Float32Array(8)));
  }
}

Deno.test(
  "LibsqlSearchIndex - degrades to keyword-only search when embeddingService throws",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    await client.execute({
      sql:
        `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      args: [
        "id-fts",
        "urn:fallback",
        "urn:prop",
        "urn:g",
        "Unique fallback keyword phrase",
        "Unique fallback keyword phrase",
      ],
    });

    const searchIndex = new LibsqlSearchIndex({
      connection,
      embeddingService: new FailingEmbeddingService(),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const response = await searchIndex.search({ query: "fallback keyword" });

    assertEquals(response.results?.length, 1);
    assertEquals(response.results?.[0].subject, "urn:fallback");
  },
);

Deno.test(
  "LibsqlSearchIndex - degrades when embedding dimensions do not match schema",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    await client.execute({
      sql:
        `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      args: [
        "id-dim",
        "urn:dim",
        "urn:prop",
        "urn:g",
        "Dimension mismatch keyword target",
        "Dimension mismatch keyword target",
      ],
    });

    const searchIndex = new LibsqlSearchIndex({
      connection,
      embeddingService: new WrongDimensionEmbeddingService(),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const response = await searchIndex.search({
      query: "dimension mismatch",
    });

    assertEquals(response.results?.length, 1);
    assertEquals(response.results?.[0].subject, "urn:dim");
  },
);

Deno.test("LibsqlSearchIndex - respects custom result limit option", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  const vecStr = JSON.stringify(new Array(32).fill(0));

  for (let index = 0; index < 5; index++) {
    await client.execute({
      sql:
        `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
      args: [
        `id-${index}`,
        `urn:row:${index}`,
        "urn:prop",
        "urn:g",
        `Shared limit keyword row ${index}`,
        `Shared limit keyword row ${index}`,
        vecStr,
      ],
    });
  }

  const searchIndex = new LibsqlSearchIndex({
    connection,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
    limit: 2,
  });

  const response = await searchIndex.search({ query: "limit keyword" });

  assertExists(response.results);
  assertEquals(
    response.results.length,
    2,
    "Custom limit should cap the number of returned rows",
  );
});

Deno.test("LibsqlSearchIndex - non-ASCII queries do not crash and match via unicode61 (parity #21)", async () => {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      "id-ar",
      "urn:item1",
      "urn:greeting",
      "",
      "\u0645\u0631\u062d\u0628\u0627",
      "\u0645\u0631\u062d\u0628\u0627",
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    connection,
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const response = await searchIndex.search({
    query: "\u0645\u0631\u062d\u0628\u0627",
  });

  assertExists(response.results);
  assertEquals(
    response.results.length,
    1,
    "Arabic query must match the Arabic chunk without crashing FTS5",
  );
  assertEquals(response.results[0].text, "\u0645\u0631\u062d\u0628\u0627");
});
