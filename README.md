<p align="center">
  <a href="https://docs.wazoo.dev">
    <img src="https://wazoo.dev/assets/wazoo.svg" alt="Wazoo Worlds" width="120" />
  </a>
  <br /><br />
  <em>LibSQL/Turso storage and hybrid search backend for Worlds.</em>
  <br /><br />
  <a href="https://jsr.io/@worlds/libsql"><img src="https://jsr.io/badges/@worlds/libsql" alt="JSR" /></a>
  <a href="https://jsr.io/@worlds/libsql/score"><img src="https://jsr.io/badges/@worlds/libsql/score" alt="JSR Score" /></a>
  <a href="https://github.com/wazootech/worlds-libsql"><img src="https://img.shields.io/badge/GitHub-black?logo=github" alt="GitHub" /></a>
  <a href="https://deepwiki.com/wazootech/worlds-libsql"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>
</p>

Standalone LibSQL package extracted from
[`@worlds/sdk`](https://jsr.io/@worlds/sdk).

## Install

```bash
deno add jsr:@worlds/libsql
```

## Usage

### Full client: quad store + search index + SPARQL

```typescript
import { createClient } from "@libsql/client";
import { createLibsqlClient } from "@worlds/libsql";

const databaseClient = createClient({ url: ":memory:" });
// The factory assembles the three provider-seam strategy objects internally
// (worlds-sdk-ts#170): a ConnectionDriver over the raw client, the schema
// builder, and the search-query builder. Callers just pass the LibSQL client.
const client = await createLibsqlClient({ client: databaseClient });

await client.import({
  source: {
    kind: "serialized",
    data:
      `<http://example.com/alice> <http://example.com/knows> <http://example.com/bob> .`,
    contentType: "text/turtle",
  },
});

const { search, sparql } = await Promise.all([
  client.search({ query: "alice" }),
  client.sparql({
    query:
      `SELECT ?o WHERE { <http://example.com/alice> <http://example.com/knows> ?o }`,
  }),
]);
```

### SPARQL only: the RDF/JS store + `WazooSparqlEngine` over LibSQL

When you only need SPARQL over an RDF/JS store backed by LibSQL (no chunk
search, no embeddings), wire `LibsqlRdfjsStore` directly into
`@wazoo/sparql-engine`'s `WazooSparqlEngine`:

```typescript
import { createClient } from "@libsql/client";
import type * as rdfjs from "@rdfjs/types";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import {
  initializeLibsqlSchema,
  LibsqlConnectionDriver,
  LibsqlQuadStore,
  LibsqlRdfjsStore,
  LibsqlSchemaBuilder,
  LibsqlSearchQueryBuilder,
} from "@worlds/libsql";

// A raw LibSQL client — in-memory here, any remote/embedded URL works.
const databaseClient = createClient({ url: ":memory:" });

// Create the quads table + covering indexes (no FTS/vector chunk schema).
const schemaBuilder = new LibsqlSchemaBuilder(32);
const connection = new LibsqlConnectionDriver(databaseClient);
await initializeLibsqlSchema(connection, schemaBuilder);

// The RDF/JS read source over LibSQL: match/countQuads via SQL index seeks.
const store = new LibsqlRdfjsStore({ connection });

// A quad store for writes (import/export/transaction); chunk projection
// is skipped by leaving searchIndexProjector unset.
const quadStore = new LibsqlQuadStore({
  connection,
  store,
  searchQueryBuilder: new LibsqlSearchQueryBuilder(32),
});

// SPARQL engine over the same LibSQL-backed store.
const sparqlEngine = new WazooSparqlEngine({
  store: store as unknown as rdfjs.Store,
  createTransaction: () => quadStore.createTransaction(),
});

await quadStore.import({
  source: {
    kind: "serialized",
    data:
      `<http://example.com/alice> <http://example.com/knows> <http://example.com/bob> .`,
    contentType: "text/turtle",
  },
});

const result = await sparqlEngine.execute({
  query:
    `SELECT ?o WHERE { <http://example.com/alice> <http://example.com/knows> ?o }`,
});
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
