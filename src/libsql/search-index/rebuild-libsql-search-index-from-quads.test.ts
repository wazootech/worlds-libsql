import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";
import {
  LibsqlQuadStore,
  type LibsqlQuadStoreOptions,
} from "@/libsql/quad-store/mod.ts";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import type { Patch, TransactionContext } from "@worlds/sdk/quad-store";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSchemaBuilder,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

/** Compat helper wrapping LibsqlQuadStore for testing. */
function createLibsqlPersistHooks(
  options: Omit<LibsqlQuadStoreOptions, "store">,
) {
  const store = new LibsqlRdfjsStore({
    connection: options.connection,
    matchPageSize: options.matchPageSize,
  });
  const quadStore = new LibsqlQuadStore({
    ...options,
    store,
  });
  return {
    commit: async (patch: Patch, context?: TransactionContext) => {
      const tx = quadStore.createTransaction();
      if (patch.insertions) {
        tx.addQuads(patch.insertions);
      }
      if (patch.deletions) {
        tx.removeQuads(patch.deletions);
      }
      await tx.commit(context);
    },
  };
}
import { LibsqlSearchIndex } from "./libsql-search-index.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "./rebuild-libsql-search-index-from-quads.ts";

const { quad, namedNode, literal } = DataFactory;

const AURELIA = "http://example.org/Aurelia";
const HAS_CAPITAL = "http://example.org/hasCapital";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - fts_value is object text only; subject IRIs are not searchable",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const persistHooks = createLibsqlPersistHooks({
      connection,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        connection,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const capitalQuad = quad(
      namedNode(AURELIA),
      namedNode(HAS_CAPITAL),
      literal("Lume"),
    );

    await persistHooks.commit({
      insertions: [capitalQuad],
      deletions: [],
    });

    const chunkRows = await client.execute(
      "SELECT value, fts_value FROM chunks",
    );
    assertEquals(chunkRows.rows[0].value, "Lume");
    assertEquals(
      String(chunkRows.rows[0].fts_value),
      "Lume",
      "fts_value must index the object text only",
    );

    const searchIndex = new LibsqlSearchIndex({
      connection,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const subjectHit = await searchIndex.search({ query: "Aurelia" });
    assertEquals(
      subjectHit.results?.length,
      0,
      "subject IRI must never match keyword search",
    );

    const valueHit = await searchIndex.search({ query: "Lume" });
    assertEquals(valueHit.results?.length, 1);
    assertEquals(valueHit.results?.[0].subject, AURELIA);
    assertEquals(valueHit.results?.[0].text, "Lume");
  },
);

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - label quads match by their own text, not as aliases for sibling facts",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const persistHooks = createLibsqlPersistHooks({
      connection,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        connection,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const capitalQuad = quad(
      namedNode(AURELIA),
      namedNode(HAS_CAPITAL),
      literal("Lume"),
    );
    const labelQuad = quad(
      namedNode(AURELIA),
      namedNode(RDFS_LABEL),
      literal("Kingdom of Aurelia"),
    );

    await persistHooks.commit({
      insertions: [capitalQuad, labelQuad],
      deletions: [],
    });

    const searchIndex = new LibsqlSearchIndex({
      connection,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const labelHit = await searchIndex.search({ query: "Kingdom" });
    assertEquals(labelHit.results?.length, 1);
    assertEquals(labelHit.results?.[0].predicate, RDFS_LABEL);
    assertEquals(
      labelHit.results?.some((result) => result.predicate === HAS_CAPITAL),
      false,
      "label text must not fan out to sibling fact chunks",
    );

    const capitalHit = await searchIndex.search({ query: "Lume" });
    assertEquals(capitalHit.results?.length, 1);
    assertEquals(capitalHit.results?.[0].predicate, HAS_CAPITAL);
  },
);

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - rebuild refreshes fts_value after schema-style reindex",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const persistHooks = createLibsqlPersistHooks({
      connection,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        connection,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const capitalQuad = quad(
      namedNode(AURELIA),
      namedNode(HAS_CAPITAL),
      literal("Lume"),
    );

    await persistHooks.commit({
      insertions: [capitalQuad],
      deletions: [],
    });

    await client.execute({
      sql: "UPDATE chunks SET fts_value = ? WHERE predicate = ?",
      args: ["Lume", HAS_CAPITAL],
    });
    await client.execute(
      testLibsqlSchemaBuilder.buildRebuildChunksFtsIndex(),
    );

    const rebuildResult = await rebuildLibsqlSearchIndexFromQuads({
      connection,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    assertEquals(rebuildResult.processedQuadCount, 1);
    assertEquals(rebuildResult.chunkRowCount, 1);

    const chunkRows = await client.execute(
      "SELECT value, fts_value FROM chunks",
    );
    assertEquals(chunkRows.rows[0].value, "Lume");
    assertEquals(String(chunkRows.rows[0].fts_value), "Lume");

    const searchIndex = new LibsqlSearchIndex({
      connection,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });
    const subjectHit = await searchIndex.search({ query: "Aurelia" });
    assertEquals(
      subjectHit.results?.length,
      0,
      "rebuild must not restore subject-surface matching",
    );
  },
);

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - subject IRI does not leak into keyword search (parity #22 corpus case)",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const persistHooks = createLibsqlPersistHooks({
      connection,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        connection,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    // The exact shape that surfaced #22: quad whose subject urn:alice
    // must not make the row match a query for "alice".
    const sailingQuad = quad(
      namedNode("urn:alice"),
      namedNode("urn:activity"),
      literal("sailing", "en"),
    );

    await persistHooks.commit({
      insertions: [sailingQuad],
      deletions: [],
    });

    const searchIndex = new LibsqlSearchIndex({
      connection,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const subjectHit = await searchIndex.search({ query: "alice" });
    assertExists(subjectHit.results);
    assertEquals(
      subjectHit.results.length,
      0,
      '"alice" must not match via the subject IRI urn:alice',
    );

    const valueHit = await searchIndex.search({ query: "sailing" });
    assertEquals(valueHit.results?.length, 1);
    assertEquals(valueHit.results?.[0].subject, "urn:alice");
  },
);
