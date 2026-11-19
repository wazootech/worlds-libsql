import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { DataFactory } from "n3";
import { LibsqlQuadStore } from "@/libsql/quad-store/mod.ts";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import type { LibsqlConnectionDriver } from "@/libsql/libsql-connection-driver.ts";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  createTestLibsqlConnectionDriver,
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

const { quad, namedNode, literal } = DataFactory;

/** BrokenChunkProjector emits a chunk statement the database rejects. */
class BrokenChunkProjector extends LibsqlSearchIndexProjector {
  public override buildNovelQuadStatements(): Promise<never[]> {
    return Promise.resolve(
      ["INSERT INTO no_such_table VALUES (1)"] as never[],
    );
  }
}

async function openDatabase() {
  const client = createClient({ url: ":memory:" });
  const connection = createTestLibsqlConnectionDriver(client);
  await setupLibsqlSchemaForTest(connection);
  return { client, connection };
}

function openStore(
  connection: LibsqlConnectionDriver,
  options: {
    embeddingService?: EmbeddingService;
    mode?: "incremental" | "deferred" | "disabled";
    projector?: typeof LibsqlSearchIndexProjector;
  } = {},
) {
  const Projector = options.projector ?? LibsqlSearchIndexProjector;
  return new LibsqlQuadStore({
    connection,
    store: new LibsqlRdfjsStore({ connection, matchPageSize: 100 }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
    searchIndexProjector: new Projector({
      connection,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      embeddingService: options.embeddingService ?? new FakeEmbeddingService(),
    }),
    searchIndexOnImport: options.mode,
  });
}

async function count(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(result.rows[0].n);
}

function countBatches(client: Client): () => number {
  let batches = 0;
  const realBatch = client.batch.bind(client);
  client.batch = ((...args: Parameters<Client["batch"]>) => {
    batches++;
    return realBatch(...args);
  }) as Client["batch"];
  return () => batches;
}

const fact = (id: string, text: string) =>
  quad(namedNode(`urn:s:${id}`), namedNode("urn:p"), literal(text));

Deno.test("commit writes quads and chunks in one atomic batch", async () => {
  const { client, connection } = await openDatabase();
  const batches = countBatches(client);

  const tx = openStore(connection).createTransaction();
  tx.addQuads([fact("1", "alpha text"), fact("2", "beta text")]);
  await tx.commit();

  assertEquals(await count(client, "quads"), 2);
  assertEquals(await count(client, "chunks"), 2);
  assertEquals(batches(), 1, "quads and chunks must share one write batch");
});

Deno.test("embedding failure writes nothing and keeps existing data", async () => {
  const { client, connection } = await openDatabase();
  const seed = openStore(connection).createTransaction();
  seed.addQuads([fact("seed", "already stored")]);
  await seed.commit();

  const failing = openStore(connection, {
    embeddingService: {
      embed: () => Promise.reject(new Error("embedding service down")),
    } as unknown as EmbeddingService,
  }).createTransaction();
  failing.addQuads([fact("new", "will not be written")]);
  await assertRejects(() => failing.commit(), Error, "failed to vectorize");

  assertEquals(await count(client, "quads"), 1, "only the seeded quad");
  assertEquals(await count(client, "chunks"), 1);
});

Deno.test("a failing chunk statement rolls the quad rows back too", async () => {
  const { client, connection } = await openDatabase();
  const tx = openStore(connection, { projector: BrokenChunkProjector })
    .createTransaction();
  tx.addQuads([fact("1", "alpha text")]);
  await assertRejects(() => tx.commit(), Error, "failed to execute sync batch");

  assertEquals(await count(client, "quads"), 0, "quads roll back with chunks");
  assertEquals(await count(client, "chunks"), 0);
});

Deno.test("a failed replace import keeps the existing graph", async () => {
  const { client, connection } = await openDatabase();
  const seed = openStore(connection).createTransaction();
  seed.addQuads([fact("old", "old graph data")]);
  await seed.commit();

  const broken = openStore(connection, { projector: BrokenChunkProjector });
  await assertRejects(() =>
    broken.import({
      mode: "replace",
      source: { kind: "quads", quads: [fact("new", "replacement data")] },
    })
  );

  assertEquals(await count(client, "quads"), 1, "wipe must roll back");
  assertEquals(await count(client, "chunks"), 1);
});

Deno.test("replace import swaps the graph in one batch", async () => {
  const { client, connection } = await openDatabase();
  const seed = openStore(connection).createTransaction();
  seed.addQuads([fact("old", "old graph data")]);
  await seed.commit();
  const batches = countBatches(client);

  await openStore(connection).import({
    mode: "replace",
    source: { kind: "quads", quads: [fact("new", "replacement data")] },
  });

  const subjects = await client.execute("SELECT s FROM quads");
  assertEquals(subjects.rows.map((row) => row.s), ["urn:s:new"]);
  assertEquals(await count(client, "chunks"), 1);
  assertEquals(batches(), 1);
});

Deno.test("deferred import writes quads first, then rebuilds chunks", async () => {
  const { client, connection } = await openDatabase();
  const batches = countBatches(client);

  await openStore(connection, { mode: "deferred" }).import({
    source: { kind: "quads", quads: [fact("1", "deferred text")] },
  });

  assertEquals(await count(client, "quads"), 1);
  assertEquals(await count(client, "chunks"), 1, "rebuilt after the import");
  assertEquals(batches() >= 2, true, "quad batch, then rebuild batch(es)");
});

Deno.test("disabled mode writes quads without chunks", async () => {
  const { client, connection } = await openDatabase();
  const tx = openStore(connection, { mode: "disabled" }).createTransaction();
  tx.addQuads([fact("1", "alpha text")]);
  await tx.commit();

  assertEquals(await count(client, "quads"), 1);
  assertEquals(await count(client, "chunks"), 0);
});
