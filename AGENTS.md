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

CI pins Deno (now `v2.9.8`) as a temporary exception: the floating latest
segfaults the test process at shutdown (exit 139) under this repo's native
libsql bindings. Remove the pin once upstream fixes the crash.

## Code health

Family-wide rules live in the
[wazootech workspace constitution](https://github.com/wazootech/workspace/blob/main/AGENTS.md#code-health-standards);
this repo's specifics:

- Before pushing, run `deno task ci` (fmt check, lint, type check, tests).
- Deno type checking is strict by default; do not weaken it.
- No `no-explicit-any` lint ignores exist today; add none without a reason.
- Actions in `.github/workflows/` are pinned to full commit SHAs, CI pins Deno
  to `v2.9.8`, and installs are frozen (`deno ci`).
- `secret-scan.yml` runs gitleaks on every PR and push to `main`; report
  findings, never suppress them.
- `code-health.yml` is warn-only (file length, TODO/FIXME without an issue
  link); it does not fail the build.
- `.github/CODEOWNERS` and `renovate.json` are present; Renovate only acts where
  the org has the Renovate GitHub App installed.
