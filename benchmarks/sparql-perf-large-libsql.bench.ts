import { isBenchReuseDbEnabled } from "./shared/perf-db-cache.ts";
import {
  libsqlHexastorePerfBackends,
  preloadSparqlHexastorePerfFixtures,
  registerSparqlHexastorePerfBenchmarks,
  registerSparqlHexastorePerfUnloadCleanup,
} from "./shared/sparql-perf-shared.ts";

const largePerfScales = [
  100_000,
  250_000,
  500_000,
  1_000_000,
] as const;

const preloadedSparqlEngines = await preloadSparqlHexastorePerfFixtures(
  largePerfScales,
  "large libsql",
  libsqlHexastorePerfBackends,
  { reuseFileCache: isBenchReuseDbEnabled() },
);

registerSparqlHexastorePerfUnloadCleanup(preloadedSparqlEngines);
registerSparqlHexastorePerfBenchmarks(
  largePerfScales,
  preloadedSparqlEngines,
  libsqlHexastorePerfBackends,
);
