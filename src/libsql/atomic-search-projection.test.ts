import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  BrokenChunkQueryBuilder,
  count,
  fact,
  openDatabase,
  openStore,
  recordBatches,
} from "@/libsql/libsql-commit-test-helpers.ts";
import { rejected } from "@/libsql/libsql-test-fixtures.ts";

test("commit writes quads and chunks in one atomic batch", async () => {
  const { client, connection } = await openDatabase();
  const batches = recordBatches(client);

  const tx = openStore(connection).createTransaction();
  tx.addQuads([fact("1", "alpha text"), fact("2", "beta text")]);
  await tx.commit();

  assert.deepStrictEqual(await count(client, "quads"), 2);
  assert.deepStrictEqual(await count(client, "chunks"), 2);
  assert.deepStrictEqual(
    batches.length,
    1,
    "quads and chunks must share one write batch",
  );
});

test("embedding failure writes nothing and keeps existing data", async () => {
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
  await rejected(() => failing.commit(), Error, "failed to vectorize");

  assert.deepStrictEqual(
    await count(client, "quads"),
    1,
    "only the seeded quad",
  );
  assert.deepStrictEqual(await count(client, "chunks"), 1);
});

test("a failing chunk statement rolls the quad rows back too", async () => {
  const { client, connection } = await openDatabase();
  const tx = openStore(connection, {
    searchQueryBuilder: new BrokenChunkQueryBuilder(32),
  }).createTransaction();
  tx.addQuads([fact("1", "alpha text")]);
  await rejected(() => tx.commit(), Error, "failed to execute sync batch");

  assert.deepStrictEqual(
    await count(client, "quads"),
    0,
    "quads roll back with chunks",
  );
  assert.deepStrictEqual(await count(client, "chunks"), 0);
});

test("a failed replace import keeps the existing graph", async () => {
  const { client, connection } = await openDatabase();
  const seed = openStore(connection).createTransaction();
  seed.addQuads([fact("old", "old graph data")]);
  await seed.commit();

  const broken = openStore(connection, {
    searchQueryBuilder: new BrokenChunkQueryBuilder(32),
  });
  await rejected(() =>
    broken.import({
      mode: "replace",
      source: { kind: "quads", quads: [fact("new", "replacement data")] },
    }),
  );

  assert.deepStrictEqual(
    await count(client, "quads"),
    1,
    "wipe must roll back",
  );
  assert.deepStrictEqual(await count(client, "chunks"), 1);
});

test("replace import swaps the graph in one batch", async () => {
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
  assert.deepStrictEqual(
    subjects.rows.map((row) => row.s),
    ["urn:s:new"],
  );
  assert.deepStrictEqual(await count(client, "chunks"), 1);
  assert.deepStrictEqual(batches.length, 1);
});

test("deferred import writes quads first, then rebuilds chunks", async () => {
  const { client, connection } = await openDatabase();
  const batches = recordBatches(client);

  await openStore(connection, { mode: "deferred" }).import({
    source: { kind: "quads", quads: [fact("1", "deferred text")] },
  });

  assert.deepStrictEqual(await count(client, "quads"), 1);
  assert.deepStrictEqual(
    await count(client, "chunks"),
    1,
    "rebuilt after the import",
  );
  assert.deepStrictEqual(
    batches.length >= 2,
    true,
    "quad batch, then rebuild batch(es)",
  );
});

test("disabled mode writes quads without chunks", async () => {
  const { client, connection } = await openDatabase();
  const tx = openStore(connection, { mode: "disabled" }).createTransaction();
  tx.addQuads([fact("1", "alpha text")]);
  await tx.commit();

  assert.deepStrictEqual(await count(client, "quads"), 1);
  assert.deepStrictEqual(await count(client, "chunks"), 0);
});

test("deferred rebuild pages through every stored quad", async () => {
  const { client, connection } = await openDatabase();
  const quads = Array.from({ length: 1250 }, (_, index) =>
    fact(String(index), `paged text ${index}`),
  );

  await openStore(connection, { mode: "deferred" }).import({
    source: { kind: "quads", quads },
  });

  assert.deepStrictEqual(await count(client, "quads"), 1250);
  assert.deepStrictEqual(
    await count(client, "chunks"),
    1250,
    "all pages are indexed",
  );
});
