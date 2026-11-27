import { bench, runBenches } from "./shared/bench.ts";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { createLibsqlWorldsSdk } from "@/libsql/mod.ts";
import { generateSyntheticQuads } from "./shared/synthetic-data.ts";

const { quad, namedNode, literal } = DataFactory;

const databaseClient = createClient({ url: ":memory:" });
const client = await createLibsqlWorldsSdk({
  client: databaseClient,
  searchIndexOnImport: "disabled",
});

const payload100 = generateSyntheticQuads(100);

let indexCounter = 1000;
function generateFreshPayload(count: number) {
  const freshQuads = [];
  for (let i = 0; i < count; i++) {
    indexCounter++;
    freshQuads.push(
      quad(
        namedNode(`urn:entity:fresh:${indexCounter}`),
        namedNode("urn:property:name"),
        literal(`Fresh payload text for unique entity number ${indexCounter}`),
      ),
    );
  }
  return freshQuads;
}

await client.import({
  source: { kind: "quads", quads: payload100 },
});

bench(
  {
    name: "Idempotency: Novel Insert (New Quads Ingested)",
    group: "Idempotency Guard Performance",
  },
  async () => {
    // Building the 100 fresh quads is inside the timed body (Deno.bench timed
    // only the import); it is microseconds next to the import.
    const freshPayload = generateFreshPayload(100);
    await client.import({
      source: { kind: "quads", quads: freshPayload },
    });
  },
);

bench(
  {
    name: "Idempotency: Redundant Insert (Duplicate Quads Suppressed)",
    group: "Idempotency Guard Performance",
  },
  async () => {
    await client.import({
      source: { kind: "quads", quads: payload100 },
    });
  },
);

await runBenches();
