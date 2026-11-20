import { assert } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { collectQuadsFromStream } from "@worlds/sdk/quad-store";
import { runCommitConformanceSuite } from "@worlds/sdk/testing";
import type {
  CommitConformanceContract,
  CommitConformanceCreateOptions,
  CommitConformanceSubject,
} from "@worlds/sdk/testing";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";
import {
  openDatabase,
  openStore,
} from "@/libsql/libsql-commit-test-helpers.ts";

/**
 * What LibSQL promises: a commit up to maxAtomicStatements is one atomic batch,
 * so a failed write leaves nothing, a failed replace import keeps the old
 * graph, and an embedding error rejects before anything is written.
 */
const contract: CommitConformanceContract = {
  atomic: true,
  embeddingFailure: "throws",
  replaceImportFailure: "keeps-old-graph",
  defaultSearchIndexOnImport: "incremental",
};

async function createSubject(
  { searchIndexOnImport, embeddingService }: CommitConformanceCreateOptions,
): Promise<CommitConformanceSubject> {
  const { client, connection } = await openDatabase();
  let rebuilds = 0;
  let failArmed = false;

  class CountingProjector extends LibsqlSearchIndexProjector {
    public override async reindexAll(): Promise<void> {
      rebuilds++;
      await super.reindexAll();
    }
  }

  const realBatch = client.batch.bind(client);
  client.batch = ((...args: Parameters<typeof client.batch>) => {
    if (failArmed) {
      failArmed = false;
      throw new Error("injected write failure");
    }
    return realBatch(...args);
  }) as typeof client.batch;

  const store = openStore(connection, {
    embeddingService,
    mode: searchIndexOnImport,
    projector: CountingProjector,
  });
  const reader = new LibsqlRdfjsStore({ connection, matchPageSize: 100 });

  return {
    commit: async (patch, context) => {
      const transaction = store.createTransaction();
      transaction.addQuads(patch.insertions ?? []);
      transaction.removeQuads(patch.deletions ?? []);
      await transaction.commit(context);
    },
    storedQuads: () =>
      collectQuadsFromStream(
        reader.match(null, null, null, null),
      ) as Promise<rdfjs.Quad[]>,
    chunkedQuadIds: async () => {
      const result = await client.execute("SELECT quad_id FROM chunks");
      return result.rows.map((row) => String(row.quad_id));
    },
    failNextWrite: () => {
      failArmed = true;
    },
    fullRebuildCount: () => rebuilds,
  };
}

Deno.test("LibsqlQuadStore passes the shared commit conformance suite", async () => {
  const report = await runCommitConformanceSuite({
    contract,
    create: createSubject,
  });
  const failures = report.results.flatMap((result) =>
    result.failures.map((failure) => `${result.name}: ${failure}`)
  );
  assert(report.ok, failures.join("\n"));
});
