# Worlds LibSQL

Standalone LibSQL package extracted from
[`@worlds/client`](https://jsr.io/@worlds/client).

## Install

```bash
deno add jsr:@worlds/libsql
```

## Usage

```typescript
import { createClient } from "@libsql/client";
import { createLibsqlClient } from "@worlds/libsql";
import { LibsqlQuadStore } from "@worlds/libsql/quad-store";
import { LibsqlSearchIndex } from "@worlds/libsql/search-index";
import { LibsqlRdfjsStore } from "@worlds/libsql/rdfjs-store";
```

## Development

```bash
deno task ci
```

Dry-run a JSR publish locally:

```bash
deno task publish:dry
```

## Publishing to JSR

Releases publish automatically when changes merge to `main`. Bump `"version"` in
[`deno.json`](deno.json) in each release PR — JSR rejects duplicate versions.

One-time setup on [jsr.io/@worlds/libsql](https://jsr.io/@worlds/libsql):

1. Open package settings and link `https://github.com/wazootech/worlds-libsql`.
2. Enable **GitHub Actions publishing** (OIDC). The
   [publish workflow](.github/workflows/publish.yml) uses `id-token: write`; no
   JSR token secret is required when OIDC is configured.
3. Confirm your GitHub account can publish to the `@worlds` org.

After setup, merging to `main` runs CI, a publish dry-run, and `deno publish`.
