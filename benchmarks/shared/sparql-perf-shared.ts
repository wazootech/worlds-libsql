import { generateSyntheticQuads } from "./synthetic-data.ts";
import { createSparqlEngineForBackend } from "./sparql-perf-engine.ts";
import {
  resolveHexastorePerfQueryShapes,
  sparqlEngineCacheKey,
  sparqlQueryForShape,
} from "./sparql-perf-config.ts";
import type {
  PreloadedSparqlFixture,
  PreloadSparqlHexastorePerfOptions,
  SparqlBackend,
  SparqlQueryShape,
} from "./sparql-perf-config.ts";

export * from "./sparql-perf-config.ts";

/**
 * preloadSparqlHexastorePerfFixtures builds corpus+engine fixtures at module load.
 * Generates synthetic quads once per scale and reuses the array across backends.
 */
export async function preloadSparqlHexastorePerfFixtures(
  perfScales: readonly number[],
  logPrefix: string,
  perfBackends: readonly SparqlBackend[],
  preloadOptions?: PreloadSparqlHexastorePerfOptions,
): Promise<Map<string, PreloadedSparqlFixture>> {
  const preloadedSparqlEngines = new Map<string, PreloadedSparqlFixture>();

  console.log(
    `Pre-populating SPARQL quad index perf engines (${logPrefix})...`,
  );

  for (const quadCount of perfScales) {
    const corpusGenerationLabel = `${logPrefix} generate ${quadCount} quads`;
    console.time(corpusGenerationLabel);
    const corpusQuads = generateSyntheticQuads(quadCount);
    console.timeEnd(corpusGenerationLabel);

    for (const backend of perfBackends) {
      const preloadLabel = `${logPrefix} ${backend} ${quadCount}`;
      console.time(preloadLabel);
      const { fixture, cacheHit } = await createSparqlEngineForBackend(
        backend,
        corpusQuads,
        preloadOptions,
      );
      console.timeEnd(preloadLabel);
      if (cacheHit) {
        console.log(`${preloadLabel} (cache hit)`);
      } else if (preloadOptions?.reuseFileCache) {
        console.log(`${preloadLabel} (imported to file cache)`);
      }
      preloadedSparqlEngines.set(
        sparqlEngineCacheKey(backend, quadCount),
        fixture,
      );
    }
  }

  console.log(`SPARQL quad index perf engines ready (${logPrefix}).`);
  return preloadedSparqlEngines;
}

/**
 * registerSparqlHexastorePerfUnloadCleanup closes database handles when the bench module unloads.
 */
export function registerSparqlHexastorePerfUnloadCleanup(
  preloadedSparqlEngines: Map<string, PreloadedSparqlFixture>,
): void {
  globalThis.addEventListener("unload", () => {
    for (const fixture of preloadedSparqlEngines.values()) {
      fixture.databaseClient?.close();
    }
  });
}

/**
 * registerSparqlHexastorePerfBenchmarks registers execute-only quad index perf Deno.bench entries.
 */
export function registerSparqlHexastorePerfBenchmarks(
  perfScales: readonly number[],
  preloadedSparqlEngines: Map<string, PreloadedSparqlFixture>,
  perfBackends: readonly SparqlBackend[],
  queryShapes: readonly SparqlQueryShape[] = resolveHexastorePerfQueryShapes(),
): void {
  for (const quadCount of perfScales) {
    for (const queryShape of queryShapes) {
      for (const backend of perfBackends) {
        const query = sparqlQueryForShape(queryShape);
        const cacheKey = sparqlEngineCacheKey(backend, quadCount);
        Deno.bench({
          name:
            `SPARQL Hexastore Perf: ${quadCount} quads | ${queryShape} | ${backend}`,
          group: `SPARQL Hexastore Perf (${quadCount})`,
          async fn(benchContext) {
            const fixture = preloadedSparqlEngines.get(cacheKey);
            if (!fixture) {
              throw new Error(`Missing preloaded SPARQL fixture: ${cacheKey}`);
            }

            benchContext.start();
            await fixture.client.sparql({ query });
            benchContext.end();
          },
        });
      }
    }
  }
}
