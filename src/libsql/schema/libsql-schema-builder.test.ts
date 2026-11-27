import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlSchemaBuilder } from "./libsql-schema-builder.ts";

const testSchemaBuilder = new LibsqlSchemaBuilder(32);

test("buildIndexes - returns 7 covering index DDL statements", () => {
  const indexes = testSchemaBuilder.buildIndexes();
  assert.deepStrictEqual(indexes.length, 7);

  const subjectFirstQuadPatternIndex = indexes.find((s: string) =>
    s.includes("idx_quads_spog"),
  );
  assert.deepStrictEqual(
    subjectFirstQuadPatternIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_spog ON quads(s, p, o, g)",
  );

  const sopgIndex = indexes.find((s: string) => s.includes("idx_quads_sopg"));
  assert.deepStrictEqual(
    sopgIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_sopg ON quads(s, o, p, g)",
  );

  const psoIndex = indexes.find((s: string) => s.includes("idx_quads_pso"));
  assert.deepStrictEqual(
    psoIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_pso ON quads(p, s, o)",
  );

  const posIndex = indexes.find((s: string) => s.includes("idx_quads_pos"));
  assert.deepStrictEqual(
    posIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_pos ON quads(p, o, s)",
  );

  const ospgIndex = indexes.find((s: string) => s.includes("idx_quads_ospg"));
  assert.deepStrictEqual(
    ospgIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_ospg ON quads(o, s, p, g)",
  );

  const opsgIndex = indexes.find((s: string) => s.includes("idx_quads_opsg"));
  assert.deepStrictEqual(
    opsgIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_opsg ON quads(o, p, s, g)",
  );

  const gpsoIndex = indexes.find((s: string) => s.includes("idx_quads_gpso"));
  assert.deepStrictEqual(
    gpsoIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_gpso ON quads(g, p, s, o)",
  );
});

test("buildIndexes - indexes are idempotent (CREATE IF NOT EXISTS)", async () => {
  const db = createClient({ url: ":memory:" });
  await db.execute(testSchemaBuilder.buildLibsqlQuadsTable());

  for (const ddl of testSchemaBuilder.buildIndexes()) {
    await db.execute(ddl);
  }

  // Second pass must not throw
  for (const ddl of testSchemaBuilder.buildIndexes()) {
    await db.execute(ddl);
  }

  // Verify all 7 indexes exist
  const resultSet = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_quads_%'",
  );
  const indexNames = resultSet.rows.map((r) => String(r.name)).sort();
  assert.deepStrictEqual(indexNames, [
    "idx_quads_gpso",
    "idx_quads_opsg",
    "idx_quads_ospg",
    "idx_quads_pos",
    "idx_quads_pso",
    "idx_quads_sopg",
    "idx_quads_spog",
  ]);
});

test("buildTables - returns quads and chunks DDL in dependency order", () => {
  const tables = testSchemaBuilder.buildTables();
  assert.deepStrictEqual(tables.length, 2);
  assert.deepStrictEqual(
    tables[0]!.includes("CREATE TABLE IF NOT EXISTS quads"),
    true,
  );
  assert.deepStrictEqual(
    tables[1]!.includes("CREATE TABLE IF NOT EXISTS chunks"),
    true,
  );
});
