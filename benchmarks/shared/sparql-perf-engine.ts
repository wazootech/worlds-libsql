import { createClient } from "@libsql/client";
import type { Quad } from "@rdfjs/types";
import { createLibsqlWorldsSdk } from "@worlds/libsql";
import {
  buildHexastorePerfFixtureChecksumInputs,
  computeHexastorePerfFixtureChecksum,
  ensureHexastorePerfCacheDirectoryExists,
  removeStaleHexastorePerfCacheFiles,
  resolveHexastorePerfDbCacheDirectory,
  resolveHexastorePerfDbCachePaths,
  tryResolveHexastorePerfCacheHit,
  writeHexastorePerfFixtureManifest,
} from "./perf-db-cache.ts";
import type {
  LibsqlHexastoreFixtureResult,
  PreloadedSparqlFixture,
  PreloadSparqlHexastorePerfOptions,
  SparqlBackend,
} from "./sparql-perf-config.ts";

/**
 * importCorpusIntoLibsqlHexastore persists quads into LibSQL without timing SPARQL execute.
 */
async function importCorpusIntoLibsqlHexastore(
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

/**
 * openLibsqlHexastoreSparqlEngine wires the WazooSparqlEngine over an existing LibsqlRdfjsStore database.
 */
async function openLibsqlHexastoreSparqlEngine(
  databaseClient: ReturnType<typeof createClient>,
): Promise<PreloadedSparqlFixture> {
  const worldsClient = await createLibsqlWorldsSdk({
    client: databaseClient,
    searchIndexOnImport: "disabled",
  });
  return { databaseClient, client: worldsClient };
}

/**
 * createLibsqlHexastoreSparqlEngine wires the WazooSparqlEngine over LibsqlRdfjsStore (no N3 hydration).
 */
async function createLibsqlHexastoreSparqlEngine(
  corpusQuads: Quad[],
  options?: { reuseFileCache?: boolean },
): Promise<LibsqlHexastoreFixtureResult> {
  if (!options?.reuseFileCache) {
    const databaseClient = createClient({ url: ":memory:" });
    await importCorpusIntoLibsqlHexastore(databaseClient, corpusQuads);
    const fixture = await openLibsqlHexastoreSparqlEngine(databaseClient);
    return { fixture, cacheHit: false };
  }

  const quadCount = corpusQuads.length;
  const cachePaths = resolveHexastorePerfDbCachePaths(quadCount, "libsqlStore");
  const checksumInputs = buildHexastorePerfFixtureChecksumInputs(
    quadCount,
    "libsqlStore",
  );
  const expectedChecksum = await computeHexastorePerfFixtureChecksum(
    checksumInputs,
  );

  const cacheHit = await tryResolveHexastorePerfCacheHit(
    cachePaths,
    expectedChecksum,
    quadCount,
  );

  if (cacheHit) {
    const databaseClient = createClient({ url: cachePaths.databaseFileUrl });
    const fixture = await openLibsqlHexastoreSparqlEngine(databaseClient);
    return { fixture, cacheHit: true };
  }

  await ensureHexastorePerfCacheDirectoryExists(
    resolveHexastorePerfDbCacheDirectory(),
  );
  await removeStaleHexastorePerfCacheFiles(cachePaths);

  const databaseClient = createClient({ url: cachePaths.databaseFileUrl });
  await importCorpusIntoLibsqlHexastore(databaseClient, corpusQuads);

  const manifest = {
    ...checksumInputs,
    checksum: expectedChecksum,
  };
  await writeHexastorePerfFixtureManifest(cachePaths.manifestPath, manifest);

  const fixture = await openLibsqlHexastoreSparqlEngine(databaseClient);
  return { fixture, cacheHit: false };
}

export async function createSparqlEngineForBackend(
  _backend: SparqlBackend,
  corpusQuads: Quad[],
  preloadOptions?: PreloadSparqlHexastorePerfOptions,
): Promise<{ fixture: PreloadedSparqlFixture; cacheHit: boolean }> {
  const { fixture, cacheHit } = await createLibsqlHexastoreSparqlEngine(
    corpusQuads,
    { reuseFileCache: preloadOptions?.reuseFileCache },
  );
  return { fixture, cacheHit };
}
