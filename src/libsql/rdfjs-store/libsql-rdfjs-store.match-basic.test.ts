import { assertEquals } from "@std/assert";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import type * as rdfjs from "@rdfjs/types";
import { collectQuadsFromStream } from "@worlds/sdk/quad-store";
import {
  createTestLibsqlRdfjsStore,
  seedQuad,
  setupSchema,
} from "./libsql-rdfjs-store-test-helpers.ts";
const { namedNode, literal, blankNode } = DataFactory;

Deno.test("LibsqlRdfjsStore.match - empty store returns empty stream", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, null, null, null),
  );
  assertEquals(results.length, 0);
});

Deno.test("LibsqlRdfjsStore.match - all four terms bound returns exact quad", async () => {
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

  const results = await collectQuadsFromStream(store.match(
    namedNode("urn:alice"),
    namedNode("urn:knows"),
    namedNode("urn:bob"),
    namedNode("urn:graph1"),
  ));

  assertEquals(results.length, 1);
  assertEquals(results[0].subject.value, "urn:alice");
  assertEquals(results[0].subject.termType, "NamedNode");
  assertEquals(results[0].predicate.value, "urn:knows");
  assertEquals(results[0].object.value, "urn:bob");
  assertEquals(results[0].graph.value, "urn:graph1");
});

Deno.test("LibsqlRdfjsStore.match - by subject only returns matching quads", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, { id: "h1", s: "urn:a", p: "urn:p1", o: "o1" });
  await seedQuad(db, { id: "h2", s: "urn:b", p: "urn:p2", o: "o2" });
  await seedQuad(db, { id: "h3", s: "urn:a", p: "urn:p3", o: "o3" });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(namedNode("urn:a"), null, null, null),
  );

  assertEquals(results.length, 2);
  for (const quad of results) {
    assertEquals(quad.subject.value, "urn:a");
  }
});

Deno.test("LibsqlRdfjsStore.match - by predicate only uses PSO index", async () => {
  const db = createClient({ url: ":memory:" });
  await setupSchema(db);
  await seedQuad(db, { id: "h1", s: "urn:a", p: "urn:target", o: "o1" });
  await seedQuad(db, { id: "h2", s: "urn:b", p: "urn:other", o: "o2" });
  await seedQuad(db, { id: "h3", s: "urn:c", p: "urn:target", o: "o3" });
  const store = createTestLibsqlRdfjsStore(db);

  const results = await collectQuadsFromStream(
    store.match(null, namedNode("urn:target"), null, null),
  );

  assertEquals(results.length, 2);
  for (const quad of results) {
    assertEquals(quad.predicate.value, "urn:target");
  }
});

Deno.test("LibsqlRdfjsStore.match - by graph only uses GPSO index", async () => {
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

  assertEquals(results.length, 1);
  assertEquals(results[0].graph.value, "urn:g1");
});

Deno.test("LibsqlRdfjsStore.match - by object only uses OPSG index", async () => {
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

  assertEquals(results.length, 1);
  assertEquals(results[0].object.value, "target");
});

Deno.test("LibsqlRdfjsStore.match - disambiguates NamedNode vs BlankNode with same value", async () => {
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
  assertEquals(namedResults.length, 1);
  assertEquals(namedResults[0].subject.termType, "NamedNode");

  const blankResults = await collectQuadsFromStream(
    store.match(blankNode("b1"), null, null, null),
  );
  assertEquals(blankResults.length, 1);
  assertEquals(blankResults[0].subject.termType, "BlankNode");
});

Deno.test("LibsqlRdfjsStore.match - literal with language tag", async () => {
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

  assertEquals(results.length, 1);
  assertEquals(results[0].object.termType, "Literal");
  const lit = results[0].object as rdfjs.Literal;
  assertEquals(lit.value, "hola");
  assertEquals(lit.language, "es");
});

Deno.test("LibsqlRdfjsStore.match - literal with datatype", async () => {
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

  assertEquals(results.length, 1);
  const lit = results[0].object as rdfjs.Literal;
  assertEquals(lit.value, "42");
  assertEquals(lit.datatype.value, "http://www.w3.org/2001/XMLSchema#integer");
});

Deno.test("LibsqlRdfjsStore.match - DefaultGraph round-trip", async () => {
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

  assertEquals(results.length, 1);
  assertEquals(results[0].graph.termType, "DefaultGraph");
});
