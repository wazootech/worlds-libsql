/**
 * Reference-side parity suite (workspace#67, #72) — keeps the L2 reference
 * continuously validated in CI, mirroring worlds-sqlite's suite.
 *
 * Runs the shared fixture corpus with reference = createMemorySdk (the
 * portable in-memory reference) and candidate = createLibsqlSdk over
 * :memory:.
 *
 * Exemptions (explicit, documented on workspace#72 — never silent):
 *   - chunkBoundaryWorld is excluded via the harness's fixtures override:
 *     libsql chunks literals at 1000 chars (the chunker divergence); memory
 *     has no chunker, so chunk-derived search ids/text cannot be compared.
 *   - rdfStarWorld reports under its declared gate (libsql cannot store
 *     RDF-star; the fixture can never fail the suite).
 *
 * Search ordering is compared set-wise (strictSearchOrder: false): bm25
 * ranking vs scan order is an engine detail, not a parity contract.
 */
import { assertEquals } from "@std/assert";
import { createClient } from "@libsql/client";
import { createLibsqlSdk } from "@/libsql/mod.ts";
import { createMemorySdk } from "@worlds/sdk/memory";
import { parityCorpus, runParitySuite } from "@worlds/sdk/testing";

const CHUNKER_DIVERGENT_FIXTURE = "chunkBoundaryWorld";

function createLibsqlSdkForParity() {
  const client = createClient({ url: ":memory:" });
  return createLibsqlSdk({ client });
}

Deno.test(
  "parity suite - libsql agrees with the in-memory reference on the corpus",
  async () => {
    const fixtures = parityCorpus.fixtures.filter(
      (fixture) => fixture.name !== CHUNKER_DIVERGENT_FIXTURE,
    );

    const report = await runParitySuite({
      reference: () => createMemorySdk(),
      candidate: () => createLibsqlSdkForParity(),
      fixtures,
      strictSearchOrder: false,
    });

    assertEquals(
      report.results.length,
      fixtures.length + parityCorpus.replaceCases.length,
      "every non-exempted corpus fixture and replace case runs on both",
    );
    assertEquals(
      report.ok,
      true,
      report.results
        .map(
          (r) =>
            `${r.name}: ${r.failures.join("; ")}` +
            `${r.notes ? ` [notes: ${r.notes.join("; ")}]` : ""}`,
        )
        .join("\n"),
    );
  },
);
