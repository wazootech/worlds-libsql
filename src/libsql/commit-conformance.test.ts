import { assert, assertStringIncludes } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { collectQuadsFromStream } from "@worlds/sdk/quad-store";
import { runCommitConformanceSuite } from "@worlds/sdk/testing";
import type { InStatement } from "@libsql/client";
import type {
  CommitConformanceContract,
  CommitConformanceCreateOptions,
  CommitConformanceSubject,
} from "@worlds/sdk/testing";
import { DataFactory } from "n3";
import { FakeEmbeddingService } from "@worlds/sdk/search-index/embedding-service";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import {
  openDatabase,
  openStore,
} from "@/libsql/libsql-commit-test-helpers.ts";

const { quad, namedNode, literal } = DataFactory;

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

/** BROKEN_CHUNK_SQL is a statement the database rejects at execution time. */
const BROKEN_CHUNK_SQL = "INSERT INTO no_such_table VALUES (1)";

function sqlOf(statement: InStatement): string {
  return typeof statement === "string" ? statement : statement.sql;
}

/** LaterWriteInjection records where an injected failure landed in its batch. */
interface LaterWriteInjection {
  /** statements is each statement's leading SQL, in batch order. */
  statements: string[];
  /** failedAt is the index of the chunk-row statement made to fail. */
  failedAt: number;
}

async function createSubject(
  { searchIndexOnImport, embeddingService }: CommitConformanceCreateOptions,
): Promise<CommitConformanceSubject & { injections: LaterWriteInjection[] }> {
  const { client, connection } = await openDatabase();
  let rebuilds = 0;
  let failArmed = false;
  let laterArmed = false;
  const injections: LaterWriteInjection[] = [];

  const realBatch = client.batch.bind(client);
  client.batch = ((...args: Parameters<typeof client.batch>) => {
    // A full rebuild starts with a batch that clears the chunk table and does
    // not touch quads (a replace-import wipe clears both).
    const sql = args[0].map((statement) =>
      typeof statement === "string"
        ? statement
        : Array.isArray(statement)
        ? statement[0]
        : statement.sql
    );
    if (
      sql.includes("DELETE FROM chunks") && !sql.includes("DELETE FROM quads")
    ) {
      rebuilds++;
    }
    if (failArmed) {
      failArmed = false;
      throw new Error("injected write failure");
    }
    if (laterArmed) {
      // Break the first chunk-row statement of the batch that writes quads. The
      // database then runs the quad inserts and rejects the chunk row inside
      // the same batch, which is what an atomic backend must roll back.
      const statements = args[0] as InStatement[];
      const failedAt = statements.findIndex((statement) =>
        sqlOf(statement).startsWith("INSERT INTO chunks")
      );
      if (failedAt >= 0) {
        laterArmed = false;
        injections.push({
          statements: statements.map((statement) =>
            sqlOf(statement).slice(0, 40)
          ),
          failedAt,
        });
        const broken = statements.map((statement, index) =>
          index === failedAt ? BROKEN_CHUNK_SQL : statement
        );
        return realBatch(broken, ...args.slice(1) as [never]);
      }
    }
    return realBatch(...args);
  }) as typeof client.batch;

  const store = openStore(connection, {
    embeddingService,
    mode: searchIndexOnImport,
  });
  const reader = new LibsqlRdfjsStore({ connection, matchPageSize: 100 });

  return {
    injections,
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
    failLaterWrite: () => {
      laterArmed = true;
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

Deno.test("failLaterWrite fails a chunk-row statement after the quad inserts in the same batch", async () => {
  const subject = await createSubject({
    searchIndexOnImport: "incremental",
    embeddingService: new FakeEmbeddingService(),
  });
  subject.failLaterWrite!();
  const error = await subject.commit(
    {
      insertions: [
        quad(namedNode("urn:a"), namedNode("urn:p"), literal("first note")),
        quad(namedNode("urn:b"), namedNode("urn:p"), literal("second note")),
      ],
      deletions: [],
    },
    undefined,
  ).then(() => undefined, (cause: unknown) => cause);
  assert(error instanceof Error, "the commit must reject");
  assertStringIncludes(String(error.message), "no_such_table");
  assert(subject.injections.length === 1, "exactly one injection");
  const { statements, failedAt } = subject.injections[0]!;
  const lastQuadInsert = statements.findLastIndex((sql) =>
    sql.startsWith("INSERT OR REPLACE INTO quads")
  );
  assert(lastQuadInsert >= 0, `no quad insert in ${statements.join(" | ")}`);
  assert(
    failedAt > lastQuadInsert,
    `the failure (statement ${failedAt}) must follow every quad insert (${lastQuadInsert})`,
  );
  assert(
    (await subject.storedQuads()).length === 0,
    "the batch must roll back",
  );
});
