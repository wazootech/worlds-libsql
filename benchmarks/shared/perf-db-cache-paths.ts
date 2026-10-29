import * as path from "@std/path";
import { SYNTHETIC_CORPUS_VERSION } from "./synthetic-data.ts";

/**
 * BENCH_LIBSQL_SCHEMA_VERSION bumps when LibSQL quad index schema or perf fixture layout changes.
 */
export const BENCH_LIBSQL_SCHEMA_VERSION = 1;

/** HexastorePerfCacheBackend labels backends that support large on-disk perf fixture reuse. */
export type HexastorePerfCacheBackend = "libsqlStore";

/** DEFAULT_HEXASTORE_PERF_CACHE_DIR is the default on-disk cache root for large perf fixtures. */
const BENCHMARKS_ROOT = path.fromFileUrl(new URL("../..", import.meta.url));

/** DEFAULT_HEXASTORE_PERF_CACHE_DIR stores large database files under benchmarks/.cache. */
export const DEFAULT_HEXASTORE_PERF_CACHE_DIR = path.join(
  BENCHMARKS_ROOT,
  ".cache",
  "perf-large",
);

/** HexastorePerfFixtureChecksumInputsBase lists manifest fields shared across backends. */
interface HexastorePerfFixtureChecksumInputsBase {
  /** syntheticCorpusVersion tracks generateSyntheticQuads revisions. */
  syntheticCorpusVersion: number;
  /** quadCount is the synthetic corpus size for this fixture. */
  quadCount: number;
  /** searchIndexOnImport records the indexing mode used during import. */
  searchIndexOnImport: "disabled";
}

/**
 * LibsqlHexastorePerfFixtureChecksumInputs is the canonical checksum input for libsqlStore fixtures.
 */
export interface LibsqlHexastorePerfFixtureChecksumInputs
  extends HexastorePerfFixtureChecksumInputsBase {
  /** backend labels the quad index wiring. */
  backend: "libsqlStore";
  /** benchLibsqlSchemaVersion tracks LibSQL schema revisions relevant to perf fixtures. */
  benchLibsqlSchemaVersion: number;
}

/**
 * HexastorePerfFixtureChecksumInputs lists manifest fields hashed for bench cache identity.
 */
export type HexastorePerfFixtureChecksumInputs =
  LibsqlHexastorePerfFixtureChecksumInputs;

/**
 * HexastorePerfFixtureManifest persists checksum inputs plus the computed digest on disk.
 */
export type HexastorePerfFixtureManifest =
  & HexastorePerfFixtureChecksumInputs
  & {
    /** checksum is the SHA-256 hex digest of canonical HexastorePerfFixtureChecksumInputs JSON. */
    checksum: string;
  };

/**
 * LibsqlHexastorePerfDbCachePaths locates the SQLite file and JSON sidecar for a cached libsql fixture.
 */
export interface LibsqlHexastorePerfDbCachePaths {
  /** backend labels the quad index wiring. */
  backend: "libsqlStore";
  /** databasePath is the absolute path to the LibSQL SQLite file. */
  databasePath: string;
  /** databaseFileUrl is the libsql client URL for databasePath. */
  databaseFileUrl: string;
  /** manifestPath is the absolute path to the JSON manifest sidecar. */
  manifestPath: string;
}

/**
 * HexastorePerfDbCachePaths locates on-disk storage and manifest paths for a cached perf fixture.
 */
export type HexastorePerfDbCachePaths = LibsqlHexastorePerfDbCachePaths;

/**
 * CachedHexastorePerfFixtureValidation holds expected row counts for a cache hit check.
 */
export interface CachedHexastorePerfFixtureValidation {
  /** quadCount is the expected number of quads in the fixture. */
  quadCount: number;
  /** expectedChecksum is the digest that must match the manifest sidecar. */
  expectedChecksum: string;
}

/**
 * isBenchReuseDbEnabled returns true when BENCH_REUSE_DB=1 enables on-disk perf fixture reuse.
 */
export function isBenchReuseDbEnabled(): boolean {
  return Deno.env.get("BENCH_REUSE_DB") === "1";
}

/**
 * isBenchHexastorePerfFullScanEnabled returns true when fullScan benches are registered (opt-in).
 */
export function isBenchHexastorePerfFullScanEnabled(): boolean {
  return Deno.env.get("BENCH_HEXASTORE_PERF_FULL_SCAN") === "1" ||
    Deno.env.get("BENCH_CROSSOVER_FULL_SCAN") === "1";
}

/**
 * resolveHexastorePerfDbCacheDirectory returns the cache root from BENCH_DB_CACHE_DIR or the default.
 */
export function resolveHexastorePerfDbCacheDirectory(): string {
  const overrideDirectory = Deno.env.get("BENCH_DB_CACHE_DIR");
  if (overrideDirectory && overrideDirectory.length > 0) {
    return path.resolve(overrideDirectory);
  }
  return DEFAULT_HEXASTORE_PERF_CACHE_DIR;
}

/**
 * resolveHexastorePerfDbCachePaths builds storage and manifest paths for a large libsqlStore scale.
 */
export function resolveHexastorePerfDbCachePaths(
  quadCount: number,
  backend: "libsqlStore",
): LibsqlHexastorePerfDbCachePaths {
  const cacheDirectory = resolveHexastorePerfDbCacheDirectory();
  const manifestPath = path.join(
    cacheDirectory,
    `${backend}-${quadCount}.json`,
  );
  const databasePath = path.join(
    cacheDirectory,
    `${backend}-${quadCount}.db`,
  );
  return {
    backend: "libsqlStore",
    databasePath,
    databaseFileUrl: path.toFileUrl(databasePath).href,
    manifestPath,
  };
}

/**
 * buildHexastorePerfFixtureChecksumInputs constructs canonical checksum inputs for a quads-only fixture.
 */
export function buildHexastorePerfFixtureChecksumInputs(
  quadCount: number,
  _backend: "libsqlStore",
): LibsqlHexastorePerfFixtureChecksumInputs {
  return {
    syntheticCorpusVersion: SYNTHETIC_CORPUS_VERSION,
    quadCount,
    searchIndexOnImport: "disabled",
    backend: "libsqlStore",
    benchLibsqlSchemaVersion: BENCH_LIBSQL_SCHEMA_VERSION,
  };
}
