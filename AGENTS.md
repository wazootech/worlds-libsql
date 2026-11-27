# AI agent coding guidelines

## Setup

Dependencies resolve through Deno (`nodeModulesDir: "auto"`); there is no
`package.json`, so do not run `npm install`. After cloning, run:

```sh
deno install
```

CI runs `deno ci` (a frozen-lockfile install) instead. Then validate with
`deno task ci`.

## Conventions

- This repo is the standalone `@worlds/libsql` package. Keep imports local to
  this repo and use `@/libsql/...` for in-repo absolute imports.
- Public exports should live in `deno.json`; keep `src/mod.ts` as the root
  barrel.
- Follow the existing JSDoc and naming style in the source files.
- Run `deno fmt` before committing, then `deno task ci` before merging.

## CI Deno pin

CI pins Deno to 2.9.5 as a temporary exception: the floating latest segfaults
the test process at shutdown (exit 139) under this repo's native libsql
bindings. Remove the pin once upstream fixes the crash.

## Runtime-neutral tests and benches

Tests use `node:test` and `node:assert/strict` (`rejected()` in
`src/libsql/libsql-test-fixtures.ts` stands in for `assertRejects`), so the same
suite runs on Deno (`deno task test`) and Bun (`bun run test:bun`, needs
`bun install` first; `package.json` and `bun.lock` exist for Bun only until the
cutover). Benches register through `benchmarks/shared/bench.ts` (mitata) and run
with `deno run --allow-all benchmarks/<name>.bench.ts` or `bun <same>`.
