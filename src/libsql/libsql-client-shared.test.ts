import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";

import type { WorldsSdkInterface } from "@worlds/sdk";
import type { LibsqlWorldsSdkOptions } from "@/libsql/create-libsql-sdk.ts";
import { createLibsqlWorldsSdk } from "@/libsql/create-libsql-sdk.ts";

const { quad, namedNode, literal } = DataFactory;

const expectedIndexNames = [
  "idx_quads_spog",
  "idx_quads_sopg",
  "idx_quads_pso",
  "idx_quads_pos",
  "idx_quads_ospg",
  "idx_quads_opsg",
  "idx_quads_gpso",
] as const;

interface LibsqlClientFixture {
  label: string;
  createClient: (
    options: LibsqlWorldsSdkOptions,
  ) => Promise<WorldsSdkInterface>;
}

const libsqlClientFixtures: LibsqlClientFixture[] = [
  { label: "quad-index", createClient: createLibsqlWorldsSdk },
];

for (const fixture of libsqlClientFixtures) {
  test(
    `${fixture.label} - initializeSchema provisions all quad indexes`,
    async () => {
      const databaseClient = createClient({ url: ":memory:" });

      await fixture.createClient({ client: databaseClient });

      const indexResultSet = await databaseClient.execute(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'quads'",
      );
      const indexNames = indexResultSet.rows.map((row) => String(row.name));
      for (const expectedName of expectedIndexNames) {
        assert.deepStrictEqual(
          indexNames.includes(expectedName),
          true,
          `missing quad index: ${expectedName}`,
        );
      }

      await fixture.createClient({ client: databaseClient });

      databaseClient.close();
    },
  );

  test(
    `${fixture.label} - import persists quads readable via SPARQL`,
    async () => {
      const databaseClient = createClient({ url: ":memory:" });

      const client = await fixture.createClient({
        client: databaseClient,
      });

      await client.import({
        source: {
          kind: "quads",
          quads: [
            quad(
              namedNode(`urn:entity:${fixture.label}`),
              namedNode("urn:label"),
              literal(`${fixture.label} adapter`),
            ),
          ],
        },
      });

      const sparqlResponse = await client.sparql({
        query:
          `SELECT ?object WHERE { <urn:entity:${fixture.label}> <urn:label> ?object }`,
      });

      assert.deepStrictEqual(sparqlResponse.kind, "select");
      if (sparqlResponse.kind === "select") {
        assert.deepStrictEqual(sparqlResponse.data.results.bindings.length, 1);
      }

      databaseClient.close();
    },
  );

  test(
    `${fixture.label} - searchIndexOnImport disabled skips chunks`,
    async () => {
      const databaseClient = createClient({ url: ":memory:" });

      const client = await fixture.createClient({
        client: databaseClient,
        searchIndexOnImport: "disabled",
      });

      await client.import({
        source: {
          kind: "quads",
          quads: [
            quad(
              namedNode(`urn:entity:sparql-only:${fixture.label}`),
              namedNode("urn:label"),
              literal("quads without search index"),
            ),
          ],
        },
      });

      const chunkRows = await databaseClient.execute(
        "SELECT COUNT(*) as total FROM chunks",
      );
      assert.deepStrictEqual(Number(chunkRows.rows[0].total), 0);

      const searchResponse = await client.search({
        query: "quads without search",
      });
      assert.deepStrictEqual(searchResponse.results?.length ?? 0, 0);

      databaseClient.close();
    },
  );

  test(
    `${fixture.label} - reindex enables search after disabled import`,
    async () => {
      const databaseClient = createClient({ url: ":memory:" });

      const client = await fixture.createClient({
        client: databaseClient,
        searchIndexOnImport: "disabled",
      });

      await client.import({
        source: {
          kind: "quads",
          quads: [
            quad(
              namedNode(`urn:entity:rebuild:${fixture.label}`),
              namedNode("urn:label"),
              literal("rebuild search index later"),
            ),
          ],
        },
      });

      const rebuildResponse = await client.reindex();
      assert.deepStrictEqual(rebuildResponse.processedQuadCount, 1);
      assert.deepStrictEqual(rebuildResponse.chunkRowCount > 0, true);

      const searchResponse = await client.search({ query: "rebuild search" });
      assert.deepStrictEqual(searchResponse.results?.length ?? 0, 1);

      databaseClient.close();
    },
  );
}
