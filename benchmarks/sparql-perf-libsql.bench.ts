import {
  libsqlHexastorePerfBackends,
  preloadSparqlHexastorePerfFixtures,
  registerSparqlHexastorePerfBenchmarks,
  registerSparqlHexastorePerfUnloadCleanup,
} from "./shared/sparql-perf-shared.ts";

const standardPerfScales = [1_000, 5_000, 10_000, 25_000, 50_000] as const;

const preloadedSparqlEngines = await preloadSparqlHexastorePerfFixtures(
  standardPerfScales,
  "standard libsql",
  libsqlHexastorePerfBackends,
);

registerSparqlHexastorePerfUnloadCleanup(preloadedSparqlEngines);
registerSparqlHexastorePerfBenchmarks(
  standardPerfScales,
  preloadedSparqlEngines,
  libsqlHexastorePerfBackends,
);
