import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@libsql/client";
import type {
  Client,
  InStatement,
  ResultSet,
  TransactionMode,
} from "@libsql/client";
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
  "LibsqlBatchExecutor - partial batch failure leaves earlier batches committed with no rollback",
  async () => {
    const batchCallLog: { batchIndex: number; stmtCount: number }[] = [];
    let callCount = 0;
    const failOnCall = 2;

    const mockClient: Client = {
      batch(
        stmts: Array<InStatement>,
        _mode?: TransactionMode,
      ): Promise<ResultSet[]> {
        callCount++;
        batchCallLog.push({
          batchIndex: callCount,
          stmtCount: (stmts as InStatement[]).length,
        });
        if (callCount >= failOnCall) {
          throw new Error(
            `Simulated Turso failure on batch #${callCount}`,
          );
        }
        return Promise.resolve([]);
      },
      execute(): Promise<ResultSet> {
        return Promise.resolve({
          columns: [],
          columnTypes: [],
          rows: [],
          rowsAffected: 0,
          lastInsertRowid: undefined,
          toJSON: () => ({}),
        });
      },
      migrate: () => Promise.resolve([]),
      transaction: () => {
        throw new Error("unused");
      },
      executeMultiple: () => Promise.resolve(),
      sync: () => Promise.resolve(undefined),
      close: () => {},
      reconnect: () => {},
      closed: false,
      protocol: "http",
    };

    const executor = new LibsqlBatchExecutor({
      client: mockClient,
      writeBatchSize: 2,
    });

    for (let i = 0; i < 5; i++) {
      await executor.stage([
        `INSERT INTO quads (quad_id, s) VALUES ('urn:id:${i * 2}', 'urn:s:${
          i * 2
        }')`,
        `INSERT INTO quads (quad_id, s) VALUES ('urn:id:${i * 2 + 1}', 'urn:s:${
          i * 2 + 1
        }')`,
      ]);
    }

    await assertRejects(
      () => executor.flush(),
    );

    assertEquals(
      batchCallLog.length,
      2,
      "Expected exactly 2 batch calls before failure: first succeeds, second fails",
    );
    assertEquals(
      batchCallLog[0].batchIndex,
      1,
      "First batch call should succeed",
    );
    assertEquals(
      batchCallLog[1].batchIndex,
      2,
      "Second batch call should fail mid-way",
    );
  },
);

Deno.test(
  "LibsqlQuadStore commit - quads persist even when searchProjector throws",
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
      1,
      "Quad must persist in DB even though search projection threw — no rollback mechanism exists between commitPatchToLibsql and projectNovelQuads",
    );
  },
);

Deno.test(
  "commitPatchToLibsql - flush failure with multi-batch write does not roll back earlier batches",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    // Insert a single known quad that we can verify gets deleted by the first batch
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

    // Build enough new quads to span multiple client.batch() calls:
    // buildBulkInsertQuads packs 80 rows per INSERT stmt.
    // With 80 new quads via deletions=[existingQuad], insertions=[80 quads]:
    //   2 (delete for existing quad) + 1 (INSERT for 80 new quads) = 3 stmts
    // With writeBatchSize=2, flush splits into 2 batches (2 + 1).
    // Batch 1 succeeds (DELETE stmts), batch 2 fails (INSERT stmts).
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

    let batchCallCount = 0;
    const originalBatch = client.batch.bind(client);

    client.batch = (stmts: InStatement[], mode?: TransactionMode) => {
      batchCallCount++;
      if (batchCallCount >= 2) {
        throw new Error(
          `Simulated Turso write failure on batch #${batchCallCount}`,
        );
      }
      return originalBatch(stmts, mode);
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

    // The pre-existing quad should have been deleted (batch 1 committed),
    // and the new quads should NOT be present (batch 2 failed).
    const finalCount = Number(
      (await client.execute("SELECT COUNT(*) as total FROM quads")).rows[0]
        .total,
    );
    assertEquals(
      finalCount,
      0,
      "Batch 1 (DELETE) committed (pre-existing quad removed), batch 2 (INSERT) did not — no SQL transaction wraps individual batch() calls",
    );
  },
);

Deno.test(
  "commitPatchToLibsql - flush error wrapping preserves original cause",
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
      "failed to execute sync batch",
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
