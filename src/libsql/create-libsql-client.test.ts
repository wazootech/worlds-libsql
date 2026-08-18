import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@libsql/client";
import { createLibsqlClient } from "./create-libsql-client.ts";
import { DataFactory } from "n3";

const { quad, namedNode, literal } = DataFactory;

Deno.test(
  "createLibsqlClient - serves SPARQL on LibsqlRdfjsStore",
  async () => {
    const databaseClient = createClient({ url: ":memory:" });
    const client = await createLibsqlClient({
      client: databaseClient,
    });

    assertExists(client);
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

    assertEquals(sparqlResponse.kind, "select");

    databaseClient.close();
  },
);

Deno.test(
  "createLibsqlClient - default WazooSparqlEngine serves SPARQL without queryEngine",
  async () => {
    const databaseClient = createClient({ url: ":memory:" });
    const client = await createLibsqlClient({
      client: databaseClient,
      // No queryEngine: the zero-dependency WazooSparqlEngine is the default
      // (decision worlds-client-ts#152 / worlds-libsql#12).
    });

    assertExists(client);
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
    assertEquals(selectResponse.kind, "select");
    if (selectResponse.kind === "select") {
      assertEquals(selectResponse.data.results.bindings.length, 1);
      assertEquals(
        selectResponse.data.results.bindings[0].o?.value,
        "default engine",
      );
    }

    // Updates route through the quad-store transaction, not just reads.
    const insertResponse = await client.sparql({
      query:
        `INSERT DATA { <urn:e2e:default> <urn:e2e:predicate> "roundtrip-via-default" }`,
    });
    assertEquals(insertResponse.kind, "void");

    const selectAfterInsert = await client.sparql({
      query: "SELECT ?o WHERE { <urn:e2e:default> <urn:e2e:predicate> ?o }",
    });
    assertEquals(selectAfterInsert.kind, "select");
    if (selectAfterInsert.kind === "select") {
      assertEquals(
        selectAfterInsert.data.results.bindings[0].o?.value,
        "roundtrip-via-default",
      );
    }

    databaseClient.close();
  },
);

Deno.test(
  "createLibsqlClient - SPARQL INSERT DATA followed by SELECT round-trips through transaction commit",
  async () => {
    const databaseClient = createClient({ url: ":memory:" });
    const client = await createLibsqlClient({
      client: databaseClient,
    });

    assertExists(client);

    const insertResponse = await client.sparql({
      query:
        `INSERT DATA { <urn:e2e:subject> <urn:e2e:predicate> "roundtrip-value" }`,
    });
    assertEquals(insertResponse.kind, "void");

    const selectResponse = await client.sparql({
      query: "SELECT ?o WHERE { <urn:e2e:subject> <urn:e2e:predicate> ?o }",
    });
    assertEquals(selectResponse.kind, "select");
    if (selectResponse.kind === "select") {
      assertEquals(selectResponse.data.results.bindings.length, 1);
      assertEquals(
        selectResponse.data.results.bindings[0].o?.value,
        "roundtrip-value",
      );
    }

    databaseClient.close();
  },
);
