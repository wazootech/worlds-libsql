import { type Client, createClient } from "@libsql/client";
import { encodeHex } from "@std/encoding/hex";
import type {
  CachedHexastorePerfFixtureValidation,
  HexastorePerfDbCachePaths,
  HexastorePerfFixtureChecksumInputs,
  HexastorePerfFixtureManifest,
} from "./perf-db-cache-paths.ts";

export * from "./perf-db-cache-paths.ts";

/**
 * computeHexastorePerfFixtureChecksum returns a SHA-256 hex digest of canonical fixture checksum inputs.
 */
export async function computeHexastorePerfFixtureChecksum(
  inputs: HexastorePerfFixtureChecksumInputs,
): Promise<string> {
  const canonicalJson = JSON.stringify(inputs);
  const encodedInputs = new TextEncoder().encode(canonicalJson);
  const digestBuffer = await crypto.subtle.digest("SHA-256", encodedInputs);
  return encodeHex(new Uint8Array(digestBuffer));
}

/**
 * readHexastorePerfFixtureManifest loads a manifest sidecar when present.
 */
export async function readHexastorePerfFixtureManifest(
  manifestPath: string,
): Promise<HexastorePerfFixtureManifest | undefined> {
  try {
    const manifestText = await Deno.readTextFile(manifestPath);
    return JSON.parse(manifestText) as HexastorePerfFixtureManifest;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * writeHexastorePerfFixtureManifest persists a manifest sidecar after a successful cache build.
 */
export async function writeHexastorePerfFixtureManifest(
  manifestPath: string,
  manifest: HexastorePerfFixtureManifest,
): Promise<void> {
  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/**
 * ensureHexastorePerfCacheDirectoryExists creates the cache directory when missing.
 */
export async function ensureHexastorePerfCacheDirectoryExists(
  cacheDirectory: string,
): Promise<void> {
  await Deno.mkdir(cacheDirectory, { recursive: true });
}

/**
 * removeStaleHexastorePerfCacheFiles deletes a partial or invalid storage and manifest pair.
 */
export async function removeStaleHexastorePerfCacheFiles(
  cachePaths: HexastorePerfDbCachePaths,
): Promise<void> {
  await Promise.all([
    Deno.remove(cachePaths.databasePath).catch(() => undefined),
    Deno.remove(cachePaths.manifestPath).catch(() => undefined),
  ]);
}

/**
 * validateCachedLibsqlHexastorePerfDatabase checks quad/chunk counts for a quads-only cache hit.
 */
export async function validateCachedLibsqlHexastorePerfDatabase(
  databaseClient: Client,
  validation: CachedHexastorePerfFixtureValidation,
): Promise<boolean> {
  const quadCountResult = await databaseClient.execute(
    "SELECT COUNT(*) AS total FROM quads",
  );
  const chunkCountResult = await databaseClient.execute(
    "SELECT COUNT(*) AS total FROM chunks",
  );
  const storedQuadCount = Number(quadCountResult.rows[0]?.total ?? -1);
  const storedChunkCount = Number(chunkCountResult.rows[0]?.total ?? -1);
  return storedQuadCount === validation.quadCount &&
    storedChunkCount === 0;
}

/**
 * tryResolveHexastorePerfCacheHit validates manifest and storage state; logs cache miss reasons.
 */
export async function tryResolveHexastorePerfCacheHit(
  cachePaths: HexastorePerfDbCachePaths,
  expectedChecksum: string,
  quadCount: number,
): Promise<boolean> {
  const manifest = await readHexastorePerfFixtureManifest(
    cachePaths.manifestPath,
  );
  if (!manifest) {
    console.log(`cache miss (${cachePaths.manifestPath}: no manifest)`);
    return false;
  }
  if (manifest.checksum !== expectedChecksum) {
    console.log("cache miss (manifest checksum mismatch)");
    return false;
  }

  try {
    await Deno.stat(cachePaths.databasePath);
  } catch {
    console.log(`cache miss (${cachePaths.databasePath}: database missing)`);
    return false;
  }

  const databaseClient = createClient({ url: cachePaths.databaseFileUrl });

  try {
    const isValid = await validateCachedLibsqlHexastorePerfDatabase(
      databaseClient,
      {
        quadCount,
        expectedChecksum,
      },
    );
    if (!isValid) {
      console.log("cache miss (quad or chunk count mismatch)");
    }
    return isValid;
  } finally {
    databaseClient.close();
  }
}
