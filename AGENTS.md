# AI agent coding guidelines

## Setup

Bun runs everything: install, tests, format, lint and type check. After
cloning, run:

```sh
bun install
```

CI runs `bun install --frozen-lockfile --ignore-scripts` instead. Then validate
with `bun run ci` (format check, Oxlint, type check, manifest check, tests).

## Conventions

- This repo is the standalone `@worlds/libsql` package. Keep imports local to
  this repo and use `@/libsql/...` for in-repo absolute imports.
- Public exports live in `jsr.json` (what gets published) and are mirrored in
  `package.json` (what Bun installs and resolves); keep `src/mod.ts` as the root
  barrel. `bun run check:manifests` fails when the two disagree on exports or
  dependency ranges (each `jsr:` dependency is an `npm:@jsr/<scope>__<name>`
  alias in `package.json`).
- Follow the existing JSDoc and naming style in the source files.
- Run `bun run fmt` before committing, then `bun run ci` before merging.
  `bun fmt` and `bun check` run a same-named `package.json` script if one
  exists, so the scripts call `bun fmt --no-script` and `bun check --no-script`.

## Runtime-neutral tests and benches

Tests use `node:test` and `node:assert/strict` (`rejected()` in
`src/libsql/libsql-test-fixtures.ts` stands in for `assertRejects`), so the
suite is runtime-neutral and the code stays Node-compatible. Benches register
through `benchmarks/shared/bench.ts` (mitata) and run with
`bun benchmarks/<name>.bench.ts`. All tests run against local libsql databases;
none runs against a real Turso server.

## Publishing

`jsr` (pinned in `devDependencies`) bundles its own Deno-based publisher and
downloads it on first use, so no Deno install is needed anywhere. The Publish
workflow runs on every push to `main` and publishes only when `jsr.json`'s
`version` is not yet on JSR. `bun run publish:dry` is the local smoke test.
