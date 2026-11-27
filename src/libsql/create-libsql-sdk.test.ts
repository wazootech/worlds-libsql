import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { createLibsqlWorldsSdk } from "./create-libsql-sdk.ts";
import { DataFactory } from "n3";

const { quad, namedNode, literal } = DataFactory;

test("createLibsqlWorldsSdk - serves SPARQL on LibsqlRdfjsStore", async () => {
  const databaseClient = createClient({ url: ":memory:" });
  const client = await createLibsqlWorldsSdk({
    client: databaseClient,
  });

  assert.ok(client);
  await client.import({
    source: {
      kind: "quads",
      quads: [
        quad(
          namedNode("urn:entity:hex"),
          namedNode("urn:label"),
          literal("persistent client"),
        ),
      ],
    },
  });

  const sparqlResponse = await client.sparql({
    query: "SELECT ?o WHERE { <urn:entity:hex> <urn:label> ?o }",
  });

  assert.deepStrictEqual(sparqlResponse.kind, "select");

  databaseClient.close();
});

test("createLibsqlWorldsSdk - default WazooSparqlEngine serves SPARQL without queryEngine", async () => {
  const databaseClient = createClient({ url: ":memory:" });
  const client = await createLibsqlWorldsSdk({
    client: databaseClient,
    // No queryEngine: the zero-dependency WazooSparqlEngine is the default
    // (decision worlds-client-ts#152 / worlds-libsql#12).
  });

  assert.ok(client);
  await client.import({
    source: {
      kind: "quads",
      quads: [
        quad(
          namedNode("urn:entity:default"),
          namedNode("urn:label"),
          literal("default engine"),
        ),
      ],
    },
  });

  const selectResponse = await client.sparql({
    query: "SELECT ?o WHERE { <urn:entity:default> <urn:label> ?o }",
  });
  assert.deepStrictEqual(selectResponse.kind, "select");
  if (selectResponse.kind === "select") {
    assert.deepStrictEqual(selectResponse.data.results.bindings.length, 1);
    assert.deepStrictEqual(
      selectResponse.data.results.bindings[0].o?.value,
      "default engine",
    );
  }

  // Updates route through the quad-store transaction, not just reads.
  const insertResponse = await client.sparql({
    query: `INSERT DATA { <urn:e2e:default> <urn:e2e:predicate> "roundtrip-via-default" }`,
  });
  assert.deepStrictEqual(insertResponse.kind, "void");

  const selectAfterInsert = await client.sparql({
    query: "SELECT ?o WHERE { <urn:e2e:default> <urn:e2e:predicate> ?o }",
  });
  assert.deepStrictEqual(selectAfterInsert.kind, "select");
  if (selectAfterInsert.kind === "select") {
    assert.deepStrictEqual(
      selectAfterInsert.data.results.bindings[0].o?.value,
      "roundtrip-via-default",
    );
  }

  databaseClient.close();
});

test("createLibsqlWorldsSdk - SPARQL INSERT DATA followed by SELECT round-trips through transaction commit", async () => {
  const databaseClient = createClient({ url: ":memory:" });
  const client = await createLibsqlWorldsSdk({
    client: databaseClient,
  });

  assert.ok(client);

  const insertResponse = await client.sparql({
    query: `INSERT DATA { <urn:e2e:subject> <urn:e2e:predicate> "roundtrip-value" }`,
  });
  assert.deepStrictEqual(insertResponse.kind, "void");

  const selectResponse = await client.sparql({
    query: "SELECT ?o WHERE { <urn:e2e:subject> <urn:e2e:predicate> ?o }",
  });
  assert.deepStrictEqual(selectResponse.kind, "select");
  if (selectResponse.kind === "select") {
    assert.deepStrictEqual(selectResponse.data.results.bindings.length, 1);
    assert.deepStrictEqual(
      selectResponse.data.results.bindings[0].o?.value,
      "roundtrip-value",
    );
  }

  databaseClient.close();
});
