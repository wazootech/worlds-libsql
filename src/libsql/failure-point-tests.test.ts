import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { LibsqlBatchExecutor } from "@/libsql/libsql-batch-executor.ts";
import { commitPatchToLibsql } from "@/libsql/commit-patch-to-libsql.ts";
import { LibsqlQuadStore } from "@/libsql/quad-store/mod.ts";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";
import { FakeEmbeddingService } from "@worlds/client/search-index/embedding-service";
import {
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

import { hashQuads } from "@worlds/client/quad-store";

const { quad, namedNode, literal } = DataFactory;

Deno.test(
  "LibsqlBatchExecutor - batch failure rolls back all statements within transaction",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const executor = new LibsqlBatchExecutor({
      client,
      writeBatchSize: 2,
    });

    await executor.stage([
      "INSERT INTO quads (id, s, s_type, p, o, o_type, o_datatype, o_lang, g, g_type) VALUES ('id1', 'urn:s1', 'NamedNode', 'urn:p', 'o1', 'Literal', '', '', '', 'DefaultGraph')",
      "INSERT INTO quads (id, s, s_type, p, o, o_type, o_datatype, o_lang, g, g_type) VALUES ('id2', 'urn:s2', 'NamedNode', 'urn:p', 'o2', 'Literal', '', '', '', 'DefaultGraph')",
      "INVALID SQL STATEMENT HERE TO FORCE FAILURE",
    ]);

    await assertRejects(() => executor.flush());

    const result = await client.execute("SELECT COUNT(*) as total FROM quads");
    assertEquals(
      Number(result.rows[0].total),
      0,
      "All inserted quads must be rolled back when any batch statement fails",
    );
  },
);

Deno.test(
  "LibsqlQuadStore commit - quads roll back when searchProjector throws",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const searchIndexProjector: LibsqlSearchIndexProjector =
      new (class FailingProjector extends LibsqlSearchIndexProjector {
        public constructor() {
          super({
            client,
            textSplitter: sharedTextSplitter,
            searchQueryBuilder: testLibsqlSearchQueryBuilder,
            labelPredicates: [],
            embeddingService: new FakeEmbeddingService(),
          });
        }

        public override projectNovelQuads(): Promise<void> {
          throw new Error("Simulated search projection failure");
        }
      })();

    const store = new LibsqlRdfjsStore({ client, matchPageSize: 100 });
    const quadStore = new LibsqlQuadStore({
      client,
      store,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexProjector,
      searchIndexOnImport: "incremental",
    });

    const testQuad = quad(
      namedNode("urn:fail:subject"),
      namedNode("urn:fail:predicate"),
      literal("orphaned quad"),
    );

    const tx = quadStore.createTransaction();
    tx.addQuads([testQuad]);

    await assertRejects(() => tx.commit());

    const quadRows = await client.execute(
      "SELECT COUNT(*) as total FROM quads WHERE s = 'urn:fail:subject'",
    );
    assertEquals(
      Number(quadRows.rows[0].total),
      0,
      "Quad must be rolled back from DB when search projection throws",
    );
  },
);

Deno.test(
  "commitPatchToLibsql - flush failure with multi-batch write rolls back earlier batches",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const existingQuad = quad(
      namedNode("urn:will-delete"),
      namedNode("urn:pred"),
      literal("will be deleted"),
    );
    const [existingHash] = await hashQuads([existingQuad]);
    await client.execute(
      "INSERT INTO quads (id, s, s_type, p, o, o_type, o_datatype, o_lang, g, g_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        existingHash!,
        "urn:will-delete",
        "NamedNode",
        "urn:pred",
        "will be deleted",
        "Literal",
        "",
        "",
        "",
        "DefaultGraph",
      ],
    );
    assertEquals(
      Number(
        (await client.execute("SELECT COUNT(*) as total FROM quads")).rows[0]
          .total,
      ),
      1,
      "Pre-existing quad should be present",
    );

    const newQuadCount = 80;
    const writeBatchSize = 2;

    const newInsertions: import("@rdfjs/types").Quad[] = [];
    for (let i = 0; i < newQuadCount; i++) {
      newInsertions.push(
        quad(
          namedNode(`urn:new:${i}`),
          namedNode("urn:pred"),
          literal(`new value ${i}`),
        ),
      );
    }

    client.batch = () => {
      throw new Error("Simulated Turso write failure");
    };

    await assertRejects(() =>
      commitPatchToLibsql(
        { insertions: newInsertions, deletions: [existingQuad] },
        {
          client,
          searchQueryBuilder: testLibsqlSearchQueryBuilder,
          maxWriteBatchSize: writeBatchSize,
        },
      )
    );

    const finalCount = Number(
      (await client.execute("SELECT COUNT(*) as total FROM quads")).rows[0]
        .total,
    );
    assertEquals(
      finalCount,
      1,
      "Pre-existing quad must remain intact because transaction rolled back all batches",
    );
  },
);

Deno.test(
  "commitPatchToLibsql - flush error wrapping preserves original cause and includes message detail",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    client.batch = () => {
      throw new Error("TURSO_NETWORK_TIMEOUT");
    };

    let caught: unknown;
    try {
      await commitPatchToLibsql(
        {
          insertions: [
            quad(namedNode("urn:err"), namedNode("urn:p"), literal("v")),
          ],
          deletions: [],
        },
        { client, searchQueryBuilder: testLibsqlSearchQueryBuilder },
      );
    } catch (e) {
      caught = e;
    }

    assertEquals(caught instanceof Error, true);
    assertEquals(
      (caught as Error).message,
      "failed to execute sync batch: TURSO_NETWORK_TIMEOUT",
    );
    assertEquals(
      (caught as Error).cause instanceof Error,
      true,
      "Original Turso error must be preserved in .cause",
    );
    assertEquals(
      ((caught as Error).cause as Error).message,
      "TURSO_NETWORK_TIMEOUT",
    );
  },
);
