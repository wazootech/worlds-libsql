import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import { LibsqlQuadStore } from "@/libsql/quad-store/mod.ts";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";
import { LibsqlSearchIndexProjector } from "./libsql-search-index-projector.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "./rebuild-libsql-search-index-from-quads.ts";

const { quad, namedNode, literal } = DataFactory;
const P = namedNode("http://example.org/p");
const GA = "http://example.org/gA";
const GB = "http://example.org/gB";
const q = (name: string, graph: string, text: string) =>
  quad(
    namedNode(`http://example.org/${name}`),
    P,
    literal(text),
    namedNode(graph),
  );

/** seeded stores two quads in graph A and one in graph B, each with chunk rows. */
async function seeded() {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);
  const options = {
    connection,
    textSplitter: sharedTextSplitter,
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
    embeddingService: new FakeEmbeddingService(),
  };
  const tx = new LibsqlQuadStore({
    connection,
    store: new LibsqlRdfjsStore({ connection }),
    searchIndexProjector: new LibsqlSearchIndexProjector(options),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  }).createTransaction();
  tx.addQuads([
    q("a1", GA, "alpha"),
    q("a2", GA, "beta"),
    q("b1", GB, "gamma"),
  ]);
  await tx.commit();
  const values = async () =>
    (await client.execute("SELECT value FROM chunks ORDER BY value")).rows.map(
      (row) => String(row.value),
    );
  assert.deepStrictEqual(await values(), ["alpha", "beta", "gamma"]);
  return { client, options, values };
}

test("rebuildLibsqlSearchIndexFromQuads - include scope replaces only in-scope rows", async () => {
  const { client, options, values } = await seeded();
  await client.execute(
    "UPDATE chunks SET value = 'stale', fts_value = 'stale'",
  );
  await client.execute(
    "INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value) VALUES ('orphan', 's', 'p', 'g', 'orphan', 'orphan')",
  );
  const result = await rebuildLibsqlSearchIndexFromQuads({
    ...options,
    include: { graphs: [GA] },
  });
  assert.deepStrictEqual(result, { processedQuadCount: 3, chunkRowCount: 2 });
  assert.deepStrictEqual(
    await values(),
    ["alpha", "beta", "orphan", "stale"],
    "graph A rows rewritten; graph B and orphan rows untouched, none cleared",
  );
});

test("rebuildLibsqlSearchIndexFromQuads - exclude scope leaves excluded rows alone", async () => {
  const { client, options, values } = await seeded();
  await client.execute(
    "UPDATE chunks SET value = 'stale' WHERE value = 'gamma'",
  );
  const result = await rebuildLibsqlSearchIndexFromQuads({
    ...options,
    exclude: { graphs: [GB] },
  });
  assert.deepStrictEqual(result, { processedQuadCount: 3, chunkRowCount: 2 });
  assert.deepStrictEqual(await values(), ["alpha", "beta", "stale"]);
});

test("rebuildLibsqlSearchIndexFromQuads - unscoped rebuild clears orphan rows and pages through all quads", async () => {
  const { client, options, values } = await seeded();
  await client.execute(
    "INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value) VALUES ('orphan', 's', 'p', 'g', 'orphan', 'orphan')",
  );
  const result = await rebuildLibsqlSearchIndexFromQuads({
    ...options,
    readPageSize: 1,
  });
  assert.deepStrictEqual(result, { processedQuadCount: 3, chunkRowCount: 3 });
  assert.deepStrictEqual(await values(), ["alpha", "beta", "gamma"]);
});
