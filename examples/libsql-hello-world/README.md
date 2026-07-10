# LibSQL hello world example

This example demonstrates how to configure and use a single process-lifetime
`Client` with a production-ready, durable LibSQL backend using Deno.

It consolidates process-scoped lifecycle patterns, hybrid search capabilities,
and optimized SPARQL queries.

## Key capabilities

This example demonstrates:

- **Process-lifetime client reuse**: Instantiating a single database client and
  reusing it for the entire process lifespan (ideal for platforms like Fly.io,
  DigitalOcean, or long-lived servers).
- **Hybrid retrieval**: Querying graph literals using a blend of keyword SQLite
  FTS5 matching and TF.js Universal Sentence Encoder (USE) vector semantic
  similarity.
- **SPARQL query optimization**: Grounded, selective subject-bound SPARQL query
  structures optimized for edge database quad index indices, contrasted against
  full-scan unbound queries.

## Running the example

Run the example with Deno:

```bash
deno task example:libsql-hello-world
```

## Core concepts

### Hybrid search

The hybrid search combines:

- Keyword similarity (using high-speed SQLite FTS5 tables).
- Semantic similarity (using pre-cached TensorFlow.js embeddings).

These two relevance metrics are blended together via Reciprocal Rank Fusion
(RRF, $k = 60$) to deliver high-precision context discovery.

### SPARQL at scale

To query high-scale graph structures, you should avoid full unbound triple scans
`?subject ?property ?object` because they scale poorly on large datasets.

Instead, production hot paths should leverage **selective, subject-bound
queries** where at least one term is grounded:

```sparql
SELECT ?property ?object WHERE { <urn:demo:entity:0> ?property ?object }
```

Grounded patterns allow `LibsqlRdfjsStore` to resolve the triples in logarithmic
time via quad index indices instead of executing slow sequential scans.
