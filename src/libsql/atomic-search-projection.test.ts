import { assertEquals, assertRejects } from "@std/assert";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  BrokenChunkProjector,
  count,
  fact,
  openDatabase,
  openStore,
  recordBatches,
} from "@/libsql/libsql-commit-test-helpers.ts";

Deno.test("commit writes quads and chunks in one atomic batch", async () => {
  const { client, connection } = await openDatabase();
  const batches = recordBatches(client);

  const tx = openStore(connection).createTransaction();
  tx.addQuads([fact("1", "alpha text"), fact("2", "beta text")]);
  await tx.commit();

  assertEquals(await count(client, "quads"), 2);
  assertEquals(await count(client, "chunks"), 2);
  assertEquals(
    batches.length,
    1,
    "quads and chunks must share one write batch",
  );
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
  const batches = recordBatches(client);

  await openStore(connection).import({
    mode: "replace",
    source: { kind: "quads", quads: [fact("new", "replacement data")] },
  });

  const subjects = await client.execute("SELECT s FROM quads");
  assertEquals(subjects.rows.map((row) => row.s), ["urn:s:new"]);
  assertEquals(await count(client, "chunks"), 1);
  assertEquals(batches.length, 1);
});

Deno.test("deferred import writes quads first, then rebuilds chunks", async () => {
  const { client, connection } = await openDatabase();
  const batches = recordBatches(client);

  await openStore(connection, { mode: "deferred" }).import({
    source: { kind: "quads", quads: [fact("1", "deferred text")] },
  });

  assertEquals(await count(client, "quads"), 1);
  assertEquals(await count(client, "chunks"), 1, "rebuilt after the import");
  assertEquals(batches.length >= 2, true, "quad batch, then rebuild batch(es)");
});

Deno.test("disabled mode writes quads without chunks", async () => {
  const { client, connection } = await openDatabase();
  const tx = openStore(connection, { mode: "disabled" }).createTransaction();
  tx.addQuads([fact("1", "alpha text")]);
  await tx.commit();

  assertEquals(await count(client, "quads"), 1);
  assertEquals(await count(client, "chunks"), 0);
});
