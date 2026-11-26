import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import type * as rdfjs from "@rdfjs/types";
import { collectQuadsFromStream } from "@worlds/sdk/quad-store";
import { LibsqlConnectionDriver } from "@/libsql/libsql-connection-driver.ts";
import { LibsqlRdfjsStore } from "./mod.ts";
import {
  rejected,
  testLibsqlSchemaBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

const { namedNode, literal, blankNode } = DataFactory;

function createTestLibsqlRdfjsStore(
  client: ReturnType<typeof createClient>,
  matchPageSize?: number,
): LibsqlRdfjsStore {
  return new LibsqlRdfjsStore({
    connection: new LibsqlConnectionDriver(client),
    matchPageSize,
  });
}

async function setupSchema(db: ReturnType<typeof createClient>): Promise<void> {
  await db.execute(testLibsqlSchemaBuilder.buildLibsqlQuadsTable());
  for (const ddl of testLibsqlSchemaBuilder.buildIndexes()) {
    await db.execute(ddl);
  }
}

interface SeedQuadOptions {
  id: string;
  s: string;
  s_type?: string;
  p: string;
  o: string;
  o_type?: string;
  o_datatype?: string | null;
  o_lang?: string | null;
  g?: string;
  g_type?: string;
}

async function seedQuad(
  db: ReturnType<typeof createClient>,
  options: SeedQuadOptions,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO quads (id, s, s_type, p, o, o_type, o_datatype, o_lang, g, g_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      options.id,
      options.s,
      options.s_type ?? "NamedNode",
      options.p,
      options.o,
      options.o_type ?? "Literal",
      options.o_datatype ?? null,
      options.o_lang ?? null,
      options.g ?? "",
      options.g_type ?? "DefaultGraph",
    ],
  });
}

// ──────────────────────────────────────────────────
// Phase 1: match() read tests
// ──────────────────────────────────────────────────

test("LibsqlRdfjsStore.match - empty store returns empty stream", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, null, null, null),
  );
  assert.deepStrictEqual(results.length, 0);
});

test("LibsqlRdfjsStore.match - all four terms bound returns exact quad", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "hash1",
    s: "urn:alice",
    s_type: "NamedNode",
    p: "urn:knows",
    o: "urn:bob",
    o_type: "NamedNode",
    g: "urn:graph1",
    g_type: "NamedNode",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(
      namedNode("urn:alice"),
      namedNode("urn:knows"),
      namedNode("urn:bob"),
      namedNode("urn:graph1"),
    ),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].subject.value, "urn:alice");
  assert.deepStrictEqual(results[0].subject.termType, "NamedNode");
  assert.deepStrictEqual(results[0].predicate.value, "urn:knows");
  assert.deepStrictEqual(results[0].object.value, "urn:bob");
  assert.deepStrictEqual(results[0].graph.value, "urn:graph1");
});

test("LibsqlRdfjsStore.match - by subject only returns matching quads", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, { id: "h1", s: "urn:a", p: "urn:p1", o: "o1" });
  await seedQuad(db, { id: "h2", s: "urn:b", p: "urn:p2", o: "o2" });
  await seedQuad(db, { id: "h3", s: "urn:a", p: "urn:p3", o: "o3" });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(namedNode("urn:a"), null, null, null),
  );

  assert.deepStrictEqual(results.length, 2);
  for (const quad of results) {
    assert.deepStrictEqual(quad.subject.value, "urn:a");
  }
});

test("LibsqlRdfjsStore.match - by predicate only uses PSO index", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, { id: "h1", s: "urn:a", p: "urn:target", o: "o1" });
  await seedQuad(db, { id: "h2", s: "urn:b", p: "urn:other", o: "o2" });
  await seedQuad(db, { id: "h3", s: "urn:c", p: "urn:target", o: "o3" });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, namedNode("urn:target"), null, null),
  );

  assert.deepStrictEqual(results.length, 2);
  for (const quad of results) {
    assert.deepStrictEqual(quad.predicate.value, "urn:target");
  }
});

test("LibsqlRdfjsStore.match - by graph only uses GPSO index", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:a",
    p: "urn:p",
    o: "o1",
    g: "urn:g1",
    g_type: "NamedNode",
  });
  await seedQuad(db, {
    id: "h2",
    s: "urn:b",
    p: "urn:p",
    o: "o2",
    g: "urn:g2",
    g_type: "NamedNode",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, null, null, namedNode("urn:g1")),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].graph.value, "urn:g1");
});

test("LibsqlRdfjsStore.match - by object only uses OPSG index", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:a",
    p: "urn:p",
    o: "target",
    o_type: "Literal",
  });
  await seedQuad(db, {
    id: "h2",
    s: "urn:b",
    p: "urn:p",
    o: "other",
    o_type: "Literal",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, null, literal("target"), null),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].object.value, "target");
});

test("LibsqlRdfjsStore.match - disambiguates NamedNode vs BlankNode with same value", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "b1",
    s_type: "NamedNode",
    p: "urn:p",
    o: "o1",
  });
  await seedQuad(db, {
    id: "h2",
    s: "b1",
    s_type: "BlankNode",
    p: "urn:p",
    o: "o2",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const namedResults = await collectQuadsFromStream(
    store.match(namedNode("b1"), null, null, null),
  );
  assert.deepStrictEqual(namedResults.length, 1);
  assert.deepStrictEqual(namedResults[0].subject.termType, "NamedNode");

  const blankResults = await collectQuadsFromStream(
    store.match(blankNode("b1"), null, null, null),
  );
  assert.deepStrictEqual(blankResults.length, 1);
  assert.deepStrictEqual(blankResults[0].subject.termType, "BlankNode");
});

test("LibsqlRdfjsStore.match - literal with language tag", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "hola",
    o_type: "Literal",
    o_lang: "es",
  });
  const store = createTestLibsqlRdfjsStore(db);

  // Match by subject+p, then check the literal
  const results = await collectQuadsFromStream(
    store.match(namedNode("urn:s"), namedNode("urn:p"), null, null),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].object.termType, "Literal");
  const lit = results[0].object as rdfjs.Literal;
  assert.deepStrictEqual(lit.value, "hola");
  assert.deepStrictEqual(lit.language, "es");
});

test("LibsqlRdfjsStore.match - literal with datatype", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "42",
    o_type: "Literal",
    o_datatype: "http://www.w3.org/2001/XMLSchema#integer",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(namedNode("urn:s"), namedNode("urn:p"), null, null),
  );

  assert.deepStrictEqual(results.length, 1);
  const lit = results[0].object as rdfjs.Literal;
  assert.deepStrictEqual(lit.value, "42");
  assert.deepStrictEqual(
    lit.datatype.value,
    "http://www.w3.org/2001/XMLSchema#integer",
  );
});

test("LibsqlRdfjsStore.match - DefaultGraph round-trip", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "o1",
    g: "",
    g_type: "DefaultGraph",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(namedNode("urn:s"), null, null, null),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].graph.termType, "DefaultGraph");
});

test("LibsqlRdfjsStore.match - literal object binding includes language constraints", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "hola",
    o_type: "Literal",
    o_lang: "es",
  });
  await seedQuad(db, {
    id: "h2",
    s: "urn:s2",
    p: "urn:p",
    o: "hello",
    o_type: "Literal",
    o_lang: "en",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(
      namedNode("urn:s"),
      namedNode("urn:p"),
      literal("hola", "es"),
      null,
    ),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual((results[0].object as rdfjs.Literal).language, "es");
});

test("LibsqlRdfjsStore.match - explicit xsd:string datatype uses IS NULL constraint", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "plain",
    o_type: "Literal",
    o_datatype: null,
  });
  await seedQuad(db, {
    id: "h2",
    s: "urn:s",
    p: "urn:p",
    o: "42",
    o_type: "Literal",
    o_datatype: "http://www.w3.org/2001/XMLSchema#integer",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(
      namedNode("urn:s"),
      namedNode("urn:p"),
      literal("plain", namedNode("http://www.w3.org/2001/XMLSchema#string")),
      null,
    ),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].object.value, "plain");
});

test("LibsqlRdfjsStore.match - NamedNode object terms round-trip", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "http://example.com/resource",
    o_type: "NamedNode",
    o_datatype: null,
    o_lang: null,
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, null, namedNode("http://example.com/resource"), null),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].object.termType, "NamedNode");
});

test("LibsqlRdfjsStore.match - BlankNode graph terms round-trip", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "value",
    g: "genid-graph",
    g_type: "BlankNode",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, null, null, blankNode("genid-graph")),
  );

  assert.deepStrictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].graph.termType, "BlankNode");
});

test("LibsqlRdfjsStore.match - propagates database errors through the result stream", async () => {
  const failingConnection = {
    execute: () => Promise.reject(new Error("database unavailable")),
  } as unknown as LibsqlConnectionDriver;
  const store = new LibsqlRdfjsStore({ connection: failingConnection });

  await rejected(
    () => collectQuadsFromStream(store.match(null, null, null, null)),
    Error,
    "database unavailable",
  );
});

test("LibsqlRdfjsStore.match - multiple named graphs are isolated", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, {
    id: "h1",
    s: "urn:s",
    p: "urn:p",
    o: "o1",
    g: "urn:g1",
    g_type: "NamedNode",
  });
  await seedQuad(db, {
    id: "h2",
    s: "urn:s",
    p: "urn:p",
    o: "o2",
    g: "urn:g2",
    g_type: "NamedNode",
  });
  const store = createTestLibsqlRdfjsStore(db);

  const g1Results = await collectQuadsFromStream(
    store.match(null, null, null, namedNode("urn:g1")),
  );
  assert.deepStrictEqual(g1Results.length, 1);
  assert.deepStrictEqual(g1Results[0].object.value, "o1");
});
