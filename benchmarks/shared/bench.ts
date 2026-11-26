/**
 * bench is the one shared benchmark harness for the bench files. It stands in
 * for `Deno.bench` (the repository's former harness): a file registers benches
 * with `bench(definition, fn)` and ends with `await runBenches()`. mitata
 * measures each registered bench in turn, grouped as registered. It runs on
 * Deno, Bun and Node.
 *
 *   bun benchmarks/hybrid-search.bench.ts                  # table on stdout
 *   bun benchmarks/hybrid-search.bench.ts --filter "FTS5"  # matching names only
 *
 * Setup that `Deno.bench` kept out of the timing with `benchContext.start()` and
 * `end()` now sits outside the registered function, or is cheap enough next to
 * the measured call that it is left inside (each bench says which).
 */
import process from "node:process";
import { measure } from "mitata";

/** BenchDefinition names one bench and the group it is compared in. */
export interface BenchDefinition {
  name: string;
  /** group collects the benches compared with each other. */
  group: string;
}

/** BenchFunction is the timed body; it may be async. */
export type BenchFunction = () => unknown;

/** BenchTimings holds one bench's statistics in nanoseconds. */
export interface BenchTimings {
  n: number;
  min: number;
  max: number;
  avg: number;
  p75: number;
  p99: number;
}

/** BenchResult is one measured bench. */
export interface BenchResult {
  group: string;
  name: string;
  timings: BenchTimings;
}

const registered: { definition: BenchDefinition; fn: BenchFunction }[] = [];

/** bench registers one bench; runBenches measures everything registered. */
export function bench(definition: BenchDefinition, fn: BenchFunction): void {
  registered.push({ definition, fn });
}

/** formatDuration prints nanoseconds in the unit a reader would pick. */
function formatDuration(nanoseconds: number): string {
  if (nanoseconds >= 1e9) return `${(nanoseconds / 1e9).toFixed(2)} s`;
  if (nanoseconds >= 1e6) return `${(nanoseconds / 1e6).toFixed(2)} ms`;
  if (nanoseconds >= 1e3) return `${(nanoseconds / 1e3).toFixed(2)} µs`;
  return `${nanoseconds.toFixed(0)} ns`;
}

/** printTable writes the human-readable report, one block per group. */
function printTable(results: BenchResult[]): void {
  const groups = [...new Set(results.map((result) => result.group))];
  for (const group of groups) {
    console.log(`\ngroup ${group}`);
    for (const row of results.filter((result) => result.group === group)) {
      const { avg, p99, n } = row.timings;
      console.log(
        `  ${row.name.padEnd(64)} avg ${formatDuration(avg).padStart(10)}` +
          `  p99 ${formatDuration(p99).padStart(10)}  n=${n}`,
      );
    }
  }
}

/** optionValue reads `--name value` from argv. */
function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * runBenches measures every registered bench in order and prints the table.
 * Progress goes to stderr so stdout stays a clean report. A bench that throws
 * fails the whole run, as a failing Deno.bench once did.
 */
export async function runBenches(
  argv: string[] = process.argv.slice(2),
): Promise<BenchResult[]> {
  const pattern = optionValue(argv, "--filter");
  const filter = pattern === undefined ? undefined : new RegExp(pattern);
  const results: BenchResult[] = [];
  for (const { definition, fn } of registered) {
    if (filter && !filter.test(`${definition.group} ${definition.name}`)) {
      continue;
    }
    console.error(`bench ${definition.group} / ${definition.name}`);
    const stats = await measure(fn);
    results.push({
      group: definition.group,
      name: definition.name,
      timings: {
        n: stats.ticks,
        min: stats.min,
        max: stats.max,
        avg: stats.avg,
        p75: stats.p75,
        p99: stats.p99,
      },
    });
  }
  printTable(results);
  return results;
}
