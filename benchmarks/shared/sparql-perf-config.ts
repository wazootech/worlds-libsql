import type { createClient } from "@libsql/client";
import type { WorldsSdkInterface } from "@worlds/sdk";
import { isBenchHexastorePerfFullScanEnabled } from "./perf-db-cache.ts";

/** selectiveSubjectIri is the grounded subject for subject-bound SPARQL benchmarks. */
export const selectiveSubjectIri = "urn:entity:0";

/** selectiveSparqlQuery exercises a subject-bound BGP (quad index-friendly). */
export const selectiveSparqlQuery =
  `SELECT ?p ?o WHERE { <${selectiveSubjectIri}> ?p ?o }`;

/** fullScanSparqlQuery exercises an unbound triple pattern with a small result cap. */
export const fullScanSparqlQuery =
  "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100";

/** SparqlQueryShape labels the SPARQL quad index perf query patterns. */
export type SparqlQueryShape = "selective" | "fullScan";

/** standardHexastorePerfQueryShapes is the default dev iteration set (subject-bound only). */
export const standardHexastorePerfQueryShapes = [
  "selective",
] as const satisfies readonly SparqlQueryShape[];

/** allHexastorePerfQueryShapes includes the unbound dev-scan shape (opt-in via BENCH_HEXASTORE_PERF_FULL_SCAN=1). */
export const allHexastorePerfQueryShapes = [
  "selective",
  "fullScan",
] as const satisfies readonly SparqlQueryShape[];

/**
 * resolveHexastorePerfQueryShapes returns query shapes for quad index perf bench registration.
 */
export function resolveHexastorePerfQueryShapes(): readonly SparqlQueryShape[] {
  return isBenchHexastorePerfFullScanEnabled()
    ? allHexastorePerfQueryShapes
    : standardHexastorePerfQueryShapes;
}

/** SparqlBackend labels the quad index wiring under test. */
export type SparqlBackend = "libsqlStore";

/** libsqlHexastorePerfBackends targets the production LibsqlRdfjsStore quad index path. */
export const libsqlHexastorePerfBackends = [
  "libsqlStore",
] as const satisfies readonly SparqlBackend[];

/** PreloadedSparqlFixture holds a warmed Client and its storage handle. */
export interface PreloadedSparqlFixture {
  /** client executes SPARQL against the preloaded corpus. */
  client: WorldsSdkInterface;
  /** databaseClient is set for libsqlStore fixtures. */
  databaseClient?: ReturnType<typeof createClient>;
}

/**
 * PreloadSparqlHexastorePerfOptions configures quad index perf module preload behavior.
 */
export interface PreloadSparqlHexastorePerfOptions {
  /** reuseFileCache enables on-disk fixtures for libsqlStore when BENCH_REUSE_DB=1. */
  reuseFileCache?: boolean;
}

/**
 * LibsqlHexastoreFixtureResult reports whether a libsqlStore fixture used the file cache.
 */
export interface LibsqlHexastoreFixtureResult {
  /** fixture is the warmed SPARQL engine and database handle. */
  fixture: PreloadedSparqlFixture;
  /** cacheHit is true when an on-disk database was reused without re-import. */
  cacheHit: boolean;
}

/**
 * sparqlEngineCacheKey builds a stable map key for preloaded quad index perf fixtures.
 */
export function sparqlEngineCacheKey(
  backend: SparqlBackend,
  quadCount: number,
): string {
  return `${backend}:${quadCount}`;
}

/**
 * sparqlQueryForShape returns the SPARQL string for a quad index perf query shape.
 */
export function sparqlQueryForShape(queryShape: SparqlQueryShape): string {
  return queryShape === "selective"
    ? selectiveSparqlQuery
    : fullScanSparqlQuery;
}
