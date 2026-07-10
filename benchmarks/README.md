# Benchmarks

Performance benchmarks for `@worlds/libsql`. **Local only** — there is no CI
regression gate; compare results manually on the same OS and Deno version.

| Resource                                                                       | Purpose                                                        |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------- |
| [Discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69) | Canonical post-preload SPARQL quad index perf write-up         |
| [Discussion #45](https://github.com/wazootech/worlds-client-ts/discussions/45) | Historical hydrate+N3 vs libsql crossover (pre-preload)        |
| [#68](https://github.com/wazootech/worlds-client-ts/issues/68)                 | Millions-of-quads production guidance (README + query helpers) |

Do not comment on closed perf threads
([#2](https://github.com/wazootech/worlds-client-ts/issues/2),
[#3](https://github.com/wazootech/worlds-client-ts/issues/3),
[#8](https://github.com/wazootech/worlds-client-ts/issues/8),
[#11](https://github.com/wazootech/worlds-client-ts/issues/11)). File a new
issue with before/after `deno bench` output instead.

**JSR:** [`@worlds/libsql`](https://jsr.io/@worlds/libsql) is published on JSR.
Tables below reflect **main** branch methodology (module preload); they are not
a substitute for re-running on your machine.

## Layout

- `*.bench.ts` — runnable benchmarks (`deno bench` discovers these at the repo
  root of `benchmarks/`, not under `shared/`).
- [`shared/`](shared/) — helpers imported by benches (`synthetic-data.ts`,
  `sparql-perf-shared.ts`).

## Run all benchmarks

```bash
deno task bench
```

Or directly:

```bash
deno bench --allow-all benchmarks/
```

### SPARQL quad index performance

The LibSQL bench is the production-default quad index execute harness.

```bash
deno bench --allow-all benchmarks/sparql-perf-libsql.bench.ts
# or
deno task bench:sparql-perf-libsql
```

**Default query shape is selective only** (subject-bound
`SELECT ?p ?o WHERE { <urn:entity:0> ?p ?o }`). Unbound dev-scan (`fullScan`) is
opt-in — it is slow and not the production hot path:

```bash
# .env or shell
BENCH_HEXASTORE_PERF_FULL_SCAN=1
deno task bench:sparql-perf-libsql:full-scan
```

Large benches use the same env via `:full-scan` tasks:

```bash
deno task bench:sparql-perf-large-libsql:full-scan
```

**Large (100k–1M):** separate libsql large bench
([#68](https://github.com/wazootech/worlds-client-ts/issues/68)). Supports
`:reuse` and `:full-scan` tasks.

Hexastore perf preload uses `searchIndexOnImport: "disabled"` (quads only; the
timed slice is `execute()`). Do **not** call `Client.reindex()` in these
harnesses — it rebuilds FTS/chunks and does not affect execute timings. Batched
quad `INSERT`s speed the untimed preload / `BENCH_REUSE_DB` cache build.

Apps that need `search()` at scale use normal import with inline indexing
(`"incremental"`, the default), `searchIndexOnImport: "deferred"` (rebuild after
each import), or `searchIndexOnImport: "disabled"` plus `await client.reindex()`
once after bulk load.

### SPARQL quad index perf at 100k–1M (opt-in, local only)

Not part of `deno task bench` — preload can take a long time and needs ample RAM
(16 GB+ for 1M preload).

```bash
deno task bench:sparql-perf-large-libsql
```

Or with a larger V8 heap if preload OOMs:

```bash
deno bench --allow-all --v8-flags=--max-old-space-size=8192 benchmarks/sparql-perf-large-libsql.bench.ts
```

Module load logs `console.time` lines per scale. Only `sparqlEngine.execute()`
is timed inside `Deno.bench`.

For full import + search preload timing (not the quad index perf execute table),
use `searchIndexOnImport: "deferred"` on a dedicated bulk-load client (quads
first, search index rebuilt after import), or `searchIndexOnImport: "disabled"`
followed by `await client.reindex()` when you want quads and search repair as
separate timed steps.

#### Reusing large fixtures (dev only)

Opt-in file cache for **large libsqlStore** preload (`BENCH_REUSE_DB=1`). The
first run imports into `benchmarks/.cache/perf-large/` (`libsqlStore-{n}.db`);
later runs open cached storage and skip import when the manifest checksum
matches (corpus version, backend schema version, quad count, quads-only import).
`Deno.bench` still measures `execute()` only.

```bash
# shell or .env
BENCH_REUSE_DB=1
deno task bench:sparql-perf-large-libsql:reuse
```

Published baselines in the table below use default `:memory:` unless labeled
**file cache**. File-backed execute can differ slightly from `:memory:` (OS page
cache). Invalidate cache: delete `benchmarks/.cache/perf-large/` or bump
`SYNTHETIC_CORPUS_VERSION` or `BENCH_LIBSQL_SCHEMA_VERSION` in
[`shared/perf-db-cache.ts`](shared/perf-db-cache.ts) and
[`shared/synthetic-data.ts`](shared/synthetic-data.ts). Override directory:
`BENCH_DB_CACHE_DIR`.

## Measurement notes

Benchmarks preload datasets and SPARQL engines at **module load**; only the hot
path runs inside `benchContext.start()` / `end()`. Write-pressure benches still
create a fresh database per iteration and use `warmup: 5`, `n: 50`.

- **avg** is the primary signal; compare like-for-like OS and Deno versions
  only.
- Large **p99** gaps vs **avg** on older runs usually meant per-iteration import
  and GC between timed slices, not multi-second SPARQL alone. After preload,
  quad index perf p99 should stay within a fewx of avg.
- Optional GC trace (local only):

  ```bash
  deno bench --allow-all --v8-flags=--trace-gc benchmarks/sparql-perf-libsql.bench.ts
  ```

**Production (millions of quads):** default to
[`createLibsqlClient`](../src/libsql/create-libsql-client.ts) for hybrid search
and faster preload. Track guidance in
[#68](https://github.com/wazootech/worlds-client-ts/issues/68).

## Baseline table (2026-05-21, pre-preload)

Captured on **Deno 2.7.14 (Windows x86_64)** before module-level preload.
Historical reference only.

| Benchmark                                      | Avg                       |
| :--------------------------------------------- | :------------------------ |
| Import 10 / 100 / 1000 quads                   | 4.9 ms / 57.3 ms / 613 ms |
| Full graph export 100 / 1k / 5k                | 3.1 ms / 12.6 ms / 152 ms |
| FTS search (2k corpus) specific / multi / miss | 2.1 ms / 10.0 ms / 1.9 ms |

## Baseline table (post-preload, 2026-05-22)

Captured on **Deno 2.8.0 (Windows x86_64)** with module-level preload.

| Benchmark                                      | Avg                        |
| :--------------------------------------------- | :------------------------- |
| Import 10 / 100 / 1000 quads                   | 4.3 ms / 60.5 ms / 615 ms  |
| Full graph export 100 / 1k / 5k                | 1.4 ms / 14.1 ms / 73.0 ms |
| FTS search (2k corpus) specific / multi / miss | 997 us / 7.3 ms / 948 us   |

## Regression policy

- Investigate when a keyed benchmark regresses by **more than ~15%** average vs
  the post-preload table on the same OS and Deno version.
- Open a **new issue** with pasted before/after `deno bench` output.
- Link
  [discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69)
  when SPARQL quad index perf numbers change.

```bash
deno task bench
```
