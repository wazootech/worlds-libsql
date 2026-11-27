import { bench, runBenches } from "./shared/bench.ts";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { createLibsqlWorldsSdk } from "@/libsql/mod.ts";

const { quad, namedNode, literal } = DataFactory;

const databaseClient = createClient({ url: ":memory:" });
const client = await createLibsqlWorldsSdk({
  client: databaseClient,
  searchIndexOnImport: "disabled",
});

let indexCounter = 3000;
function generateBatchPayload(count: number) {
  const bulkQuads = [];
  for (let i = 0; i < count; i++) {
    indexCounter++;
    bulkQuads.push(
      quad(
        namedNode(`urn:entity:sync-batch:${indexCounter}`),
        namedNode("urn:property:name"),
        literal(`Batch payload text for unique entity number ${indexCounter}`),
      ),
    );
  }
  return bulkQuads;
}

bench(
  {
    name: "Sync: Consolidated Batch Commit (10 Quads)",
    group: "Consolidated Batch Ingestion",
  },
  async () => {
    // Building the payload is inside the timed body (Deno.bench timed only the
    // import); it is microseconds next to the import.
    const payload = generateBatchPayload(10);
    await client.import({
      source: { kind: "quads", quads: payload },
    });
  },
);

bench(
  {
    name: "Sync: Consolidated Batch Commit (100 Quads)",
    group: "Consolidated Batch Ingestion",
  },
  async () => {
    // Building the payload is inside the timed body (Deno.bench timed only the
    // import); it is microseconds next to the import.
    const payload = generateBatchPayload(100);
    await client.import({
      source: { kind: "quads", quads: payload },
    });
  },
);

bench(
  {
    name: "Sync: Consolidated Batch Commit (1,000 Quads)",
    group: "Consolidated Batch Ingestion",
  },
  async () => {
    // Building the payload is inside the timed body (Deno.bench timed only the
    // import); it is microseconds next to the import.
    const payload = generateBatchPayload(1000);
    await client.import({
      source: { kind: "quads", quads: payload },
    });
  },
);

await runBenches();
