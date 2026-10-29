import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import type * as rdfjs from "@rdfjs/types";
import { collectQuadsFromStream } from "@worlds/sdk/quad-store";
import type { LibsqlConnectionDriver } from "@/libsql/libsql-connection-driver.ts";
import { LibsqlRdfjsStore } from "./mod.ts";
import {
  createTestLibsqlRdfjsStore,
  seedQuad,
  setupSchema,
} from "./libsql-rdfjs-store-test-helpers.ts";
const { namedNode, literal, blankNode } = DataFactory;

Deno.test(
  "LibsqlRdfjsStore.match - literal object binding includes language constraints",
  async () => {
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

    assertEquals(results.length, 1);
    assertEquals((results[0].object as rdfjs.Literal).language, "es");
  },
);

Deno.test(
  "LibsqlRdfjsStore.match - explicit xsd:string datatype uses IS NULL constraint",
  async () => {
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
        literal(
          "plain",
          namedNode("http://www.w3.org/2001/XMLSchema#string"),
        ),
        null,
      ),
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].object.value, "plain");
  },
);

Deno.test("LibsqlRdfjsStore.match - NamedNode object terms round-trip", async () => {
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

  assertEquals(results.length, 1);
  assertEquals(results[0].object.termType, "NamedNode");
});

Deno.test("LibsqlRdfjsStore.match - BlankNode graph terms round-trip", async () => {
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

  assertEquals(results.length, 1);
  assertEquals(results[0].graph.termType, "BlankNode");
});

Deno.test(
  "LibsqlRdfjsStore.match - propagates database errors through the result stream",
  async () => {
    const failingConnection = {
      execute: () => Promise.reject(new Error("database unavailable")),
    } as unknown as LibsqlConnectionDriver;
    const store = new LibsqlRdfjsStore({ connection: failingConnection });

    await assertRejects(
      () => collectQuadsFromStream(store.match(null, null, null, null)),
      Error,
      "database unavailable",
    );
  },
);

Deno.test("LibsqlRdfjsStore.match - multiple named graphs are isolated", async () => {
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
  assertEquals(g1Results.length, 1);
  assertEquals(g1Results[0].object.value, "o1");
});
