import { assert, assertEquals, assertRejects } from "@std/assert";
import type { EmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import {
  count,
  fact,
  openDatabase,
  openStore,
  recordBatches,
} from "@/libsql/libsql-commit-test-helpers.ts";

const FACTS = ["a", "b", "c", "d", "e", "f"].map((id) =>
  fact(id, `text for ${id}`)
);

/** commitSize is how many statements a commit of FACTS holds. */
async function commitSize(): Promise<number> {
  const { client, connection } = await openDatabase();
  const sizes = recordBatches(client);
  const tx = openStore(connection).createTransaction();
  tx.addQuads(FACTS);
  await tx.commit();
  assertEquals(sizes.length, 1);
  return sizes[0];
}

/** seeded opens a database that already holds one committed quad and chunk. */
async function seeded() {
  const { client, connection } = await openDatabase();
  const seed = openStore(connection).createTransaction();
  seed.addQuads([fact("seed", "already stored")]);
  await seed.commit();
  return { client, connection };
}

async function commitFacts(
  connection: Awaited<ReturnType<typeof openDatabase>>["connection"],
  maxAtomicStatements: number,
) {
  const tx = openStore(connection, {
    maxAtomicStatements,
    maxWriteBatchSize: 3,
  })
    .createTransaction();
  tx.addQuads(FACTS);
  await tx.commit();
}

Deno.test("a commit at maxAtomicStatements is one atomic batch", async () => {
  const total = await commitSize();
  const { client, connection } = await openDatabase();
  const sizes = recordBatches(client);

  await commitFacts(connection, total);

  assertEquals(sizes, [total]);
  assertEquals(await count(client, "quads"), FACTS.length);
});

Deno.test("a commit over maxAtomicStatements is chunked by maxWriteBatchSize", async () => {
  const total = await commitSize();
  const { client, connection } = await openDatabase();
  const sizes = recordBatches(client);

  await commitFacts(connection, total - 1);

  assertEquals(sizes.length, Math.ceil(total / 3));
  assertEquals(sizes.every((size) => size <= 3), true);
  assertEquals(sizes.reduce((sum, size) => sum + size, 0), total);
  assertEquals(await count(client, "quads"), FACTS.length);
  assertEquals(await count(client, "chunks"), FACTS.length);
});

Deno.test("fallback: a mid-commit failure deletes the quads written so far", async () => {
  const { client, connection } = await seeded();
  const sizes = recordBatches(client, (call) => call === 2);

  await assertRejects(
    () => commitFacts(connection, 1),
    Error,
    "failed to execute sync batch: TURSO_FAIL_2",
  );

  assertEquals(sizes.length >= 3, true, "batch 1, failed batch 2, cleanup");
  assertEquals(await count(client, "quads"), 1, "only the seeded quad remains");
  assertEquals(await count(client, "chunks"), 1);
});

Deno.test("fallback: a first-batch failure writes nothing and needs no cleanup", async () => {
  const { client, connection } = await seeded();
  const sizes = recordBatches(client, (call) => call === 1);

  await assertRejects(() => commitFacts(connection, 1), Error, "TURSO_FAIL_1");

  assertEquals(sizes.length, 1, "no cleanup attempted");
  assertEquals(await count(client, "quads"), 1);
});

Deno.test("fallback: if cleanup also fails, both errors surface and the partial write stays", async () => {
  const { client, connection } = await seeded();
  recordBatches(client, (call) => call >= 2);

  const error = await assertRejects(() => commitFacts(connection, 1));

  assert(error instanceof AggregateError);
  assertEquals(error.errors.map((e: Error) => e.message), [
    "failed to execute sync batch: TURSO_FAIL_2",
    "failed to execute sync batch: TURSO_FAIL_3",
  ]);
  assertEquals(
    await count(client, "quads") > 1,
    true,
    "documented inconsistency",
  );
  assertEquals(await count(client, "chunks"), 1, "chunks never written");
});

Deno.test("fallback: embedding failure still writes nothing", async () => {
  const { client, connection } = await seeded();
  const sizes = recordBatches(client);
  const store = openStore(connection, {
    maxAtomicStatements: 1,
    embeddingService: {
      embed: () => Promise.reject(new Error("embedding service down")),
    } as unknown as EmbeddingService,
  });
  const tx = store.createTransaction();
  tx.addQuads(FACTS);

  await assertRejects(() => tx.commit(), Error, "failed to vectorize");
  assertEquals(sizes.length, 0, "no write was attempted");
});

Deno.test("replace import: atomic path keeps the old graph on failure, fallback does not", async () => {
  // Atomic path: the wipe is in the same batch, so a failure rolls it back.
  const atomic = await seeded();
  recordBatches(atomic.client, (call) => call === 1);
  await assertRejects(() =>
    openStore(atomic.connection).import({
      mode: "replace",
      source: { kind: "quads", quads: FACTS },
    })
  );
  assertEquals(await count(atomic.client, "quads"), 1, "old graph kept");

  // Fallback path: the wipe is in batch 1 and is not restored if batch 2 fails.
  const chunked = await seeded();
  recordBatches(chunked.client, (call) => call === 2);
  await assertRejects(() =>
    openStore(chunked.connection, {
      maxAtomicStatements: 1,
      maxWriteBatchSize: 3,
    }).import({ mode: "replace", source: { kind: "quads", quads: FACTS } })
  );
  assertEquals(await count(chunked.client, "quads"), 0, "wiped, no orphans");
  assertEquals(await count(chunked.client, "chunks"), 0);
});

Deno.test("replace import over the threshold still swaps the graph when every batch succeeds", async () => {
  const { client, connection } = await seeded();
  const sizes = recordBatches(client);

  await openStore(connection, { maxAtomicStatements: 1, maxWriteBatchSize: 3 })
    .import({ mode: "replace", source: { kind: "quads", quads: FACTS } });

  assertEquals(sizes.length > 1, true);
  assertEquals(await count(client, "quads"), FACTS.length);
  assertEquals(await count(client, "chunks"), FACTS.length);
});
