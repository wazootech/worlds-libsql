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
  "createLibsqlPersistHooks - bulk insertions beyond SQLITE_MAX_VARIABLE_NUMBER do not fail",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const bulkQuadCount = 2_500;
    const bulkQuads = Array.from({ length: bulkQuadCount }, (_, index) =>
      quad(
        namedNode(`urn:bulk:entity:${index}`),
        namedNode("urn:bulk:predicate"),
        literal(`bulk literal ${index}`),
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
      searchIndexOnImport: "disabled", // Skip search chunk building so tests are fast
    });

    await persistHooks.commit({
      insertions: bulkQuads,
      deletions: [],
    });

    const quadRows = await client.execute(
      "SELECT COUNT(*) as total FROM quads",
    );
    assertEquals(Number(quadRows.rows[0].total), bulkQuadCount);
  },
);

Deno.test(
  "createLibsqlPersistHooks - large bulk insertions flush staged statements without stack overflow",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const largeBulkQuadCount = 50_000;
    const largeBulkQuads = Array.from(
      { length: largeBulkQuadCount },
      (_, index) =>
        quad(
          namedNode(`urn:large-bulk:entity:${index}`),
          namedNode("urn:large-bulk:predicate"),
          literal(`large bulk literal ${index}`),
        ),
    );

    const persistHooks = createLibsqlPersistHooks({
      connection,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        connection,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "disabled", // Skip search chunk building for pure bulk quad sync test
    });

    await persistHooks.commit({
      insertions: largeBulkQuads,
      deletions: [],
    });

    const quadRows = await client.execute(
      "SELECT COUNT(*) as total FROM quads",
    );
    assertEquals(Number(quadRows.rows[0].total), largeBulkQuadCount);
  },
);

Deno.test(
  "createLibsqlPersistHooks - deferred mode auto-rebuilds at the end of import",
  async () => {
    const client = createClient({ url: ":memory:" });
    const connection = createTestLibsqlConnectionDriver(client);
    await setupLibsqlSchemaForTest(connection);

    const options = {
      connection,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        connection,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "deferred" as const,
    };

    const persistHooks = createLibsqlPersistHooks(options);

    await persistHooks.commit({
      insertions: [
        quad(
          namedNode("urn:defer:entity:0"),
          namedNode("urn:defer:predicate"),
          literal("defer search index projection"),
        ),
      ],
      deletions: [],
    }, { importMode: "merge" }); // searchIndexOnImport: deferred automatically rebuilds at the end of import

    const chunkRows = await client.execute(
      "SELECT COUNT(*) as total FROM chunks",
    );
    assertEquals(Number(chunkRows.rows[0].total), 1);
  },
);

Deno.test(
  "createLibsqlPersistHooks - importMode replace wipes prior quads before insert",
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
      searchIndexOnImport: "disabled",
    });

    const priorQuad = quad(
      namedNode("urn:replace:prior"),
      namedNode("urn:predicate"),
      literal("prior"),
    );
    const replacementQuad = quad(
      namedNode("urn:replace:new"),
      namedNode("urn:predicate"),
      literal("new"),
    );

    await persistHooks.commit(
      { insertions: [priorQuad], deletions: [] },
    );

    await persistHooks.commit(
      { insertions: [replacementQuad], deletions: [] },
      { importMode: "replace" },
    );

    const quadRows = await client.execute(
      "SELECT s FROM quads ORDER BY s ASC",
    );
    assertEquals(quadRows.rows.length, 1);
    assertEquals(String(quadRows.rows[0].s), "urn:replace:new");
  },
);
