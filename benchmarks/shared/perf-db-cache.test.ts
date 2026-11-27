import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createLibsqlWorldsSdk } from "@worlds/libsql";
import type { Quad } from "@rdfjs/types";
import {
  buildHexastorePerfFixtureChecksumInputs,
  computeHexastorePerfFixtureChecksum,
  readHexastorePerfFixtureManifest,
  resolveHexastorePerfDbCachePaths,
  validateCachedLibsqlHexastorePerfDatabase,
  writeHexastorePerfFixtureManifest,
} from "./perf-db-cache.ts";
import { generateSyntheticQuads } from "./synthetic-data.ts";

async function importCorpusIntoLibsqlHexastoreForTest(
  databaseClient: ReturnType<typeof createClient>,
  corpusQuads: Quad[],
): Promise<void> {
  const worldsClient = await createLibsqlWorldsSdk({
    client: databaseClient,
    searchIndexOnImport: "disabled",
  });
  await worldsClient.import({
    source: { kind: "quads", quads: corpusQuads },
  });
}

test(
  "computeHexastorePerfFixtureChecksum - stable digest for identical inputs",
  async () => {
    const checksumInputs = buildHexastorePerfFixtureChecksumInputs(
      1000,
      "libsqlStore",
    );
    const firstChecksum = await computeHexastorePerfFixtureChecksum(
      checksumInputs,
    );
    const secondChecksum = await computeHexastorePerfFixtureChecksum(
      checksumInputs,
    );
    assert.deepStrictEqual(firstChecksum, secondChecksum);
  },
);

test(
  "computeHexastorePerfFixtureChecksum - different corpus version changes digest",
  async () => {
    const baselineInputs = buildHexastorePerfFixtureChecksumInputs(
      1000,
      "libsqlStore",
    );
    const baselineChecksum = await computeHexastorePerfFixtureChecksum(
      baselineInputs,
    );
    const alteredInputs = {
      ...baselineInputs,
      syntheticCorpusVersion: baselineInputs.syntheticCorpusVersion + 1,
    };
    const alteredChecksum = await computeHexastorePerfFixtureChecksum(
      alteredInputs,
    );
    assert.notDeepStrictEqual(baselineChecksum, alteredChecksum);
  },
);

test(
  "resolveHexastorePerfDbCachePaths - names libsqlStore database and manifest files",
  () => {
    const cachePaths = resolveHexastorePerfDbCachePaths(10, "libsqlStore");
    assert.deepStrictEqual(
      cachePaths.databasePath.endsWith("libsqlStore-10.db"),
      true,
    );
    assert.deepStrictEqual(
      cachePaths.manifestPath.endsWith("libsqlStore-10.json"),
      true,
    );
    assert.deepStrictEqual(
      cachePaths.databaseFileUrl.includes("libsqlStore-10.db"),
      true,
    );
  },
);

test(
  "validateCachedLibsqlHexastorePerfDatabase - accepts quads-only in-memory fixture",
  async () => {
    const databaseClient = createClient({ url: ":memory:" });
    try {
      await importCorpusIntoLibsqlHexastoreForTest(
        databaseClient,
        generateSyntheticQuads(10),
      );
      const expectedChecksum = await computeHexastorePerfFixtureChecksum(
        buildHexastorePerfFixtureChecksumInputs(10, "libsqlStore"),
      );
      const isValid = await validateCachedLibsqlHexastorePerfDatabase(
        databaseClient,
        { quadCount: 10, expectedChecksum },
      );
      assert.deepStrictEqual(isValid, true);
    } finally {
      databaseClient.close();
    }
  },
);

test(
  "writeHexastorePerfFixtureManifest - round-trips manifest JSON",
  async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "perf-db-cache-"),
    );
    const manifestPath = path.join(temporaryDirectory, "libsqlStore-10.json");
    try {
      const checksumInputs = buildHexastorePerfFixtureChecksumInputs(
        10,
        "libsqlStore",
      );
      const expectedChecksum = await computeHexastorePerfFixtureChecksum(
        checksumInputs,
      );
      const manifest = { ...checksumInputs, checksum: expectedChecksum };
      await writeHexastorePerfFixtureManifest(manifestPath, manifest);
      const parsedManifest = await readHexastorePerfFixtureManifest(
        manifestPath,
      );
      assert.ok(parsedManifest);
      assert.deepStrictEqual(parsedManifest.checksum, expectedChecksum);
      assert.deepStrictEqual(parsedManifest.quadCount, 10);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);
