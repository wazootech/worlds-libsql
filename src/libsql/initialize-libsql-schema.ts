import type { ConnectionDriver } from "@worlds/sdk/durable-backend";
import type { LibsqlSchemaBuilder } from "./schema/libsql-schema-builder.ts";

/**
 * initializeLibsqlSchema synchronously checks and creates the full set of persistent tables needed.
 * Hexastore covering indexes enable LibsqlRdfjsStore selective SPARQL without full hydration
 * (see https://github.com/wazootech/worlds-sdk-ts/discussions/45).
 */
export async function initializeLibsqlSchema(
  connection: ConnectionDriver,
  schemaBuilder: LibsqlSchemaBuilder,
): Promise<void> {
  for (const ddl of schemaBuilder.buildTables()) {
    await connection.execute({ sql: ddl });
  }
  for (const ddl of schemaBuilder.buildIndexes()) {
    await connection.execute({ sql: ddl });
  }
  await migrateLibsqlChunksFtsValue(connection, schemaBuilder);
  await connection.execute({
    sql: schemaBuilder.buildLibsqlChunksQuadIdIndex(),
  });
  await recreateLibsqlChunksFts(connection, schemaBuilder);
  await connection.execute({ sql: schemaBuilder.buildLibsqlChunksIndex() });
}

/**
 * migrateLibsqlChunksFtsValue adds fts_value to legacy chunk tables and backfills from value when missing.
 */
async function migrateLibsqlChunksFtsValue(
  connection: ConnectionDriver,
  schemaBuilder: LibsqlSchemaBuilder,
): Promise<void> {
  const tableInfo = await connection.execute(
    { sql: "PRAGMA table_info(chunks)" },
  );
  const hasFtsValueColumn = tableInfo.rows.some((row) =>
    String(row.name) === "fts_value"
  );

  if (!hasFtsValueColumn) {
    try {
      await connection.execute({
        sql: schemaBuilder.buildMigrateChunksFtsValueColumn(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("duplicate column")) {
        throw error;
      }
    }
    await connection.execute({
      sql: schemaBuilder.buildBackfillChunksFtsValueFromValue(),
    });
  }
}

/**
 * recreateLibsqlChunksFts rebuilds FTS5 virtual tables and triggers so discovery indexes fts_value.
 */
async function recreateLibsqlChunksFts(
  connection: ConnectionDriver,
  schemaBuilder: LibsqlSchemaBuilder,
): Promise<void> {
  for (const dropTriggerSql of schemaBuilder.buildDropChunksFtsTriggers()) {
    await connection.execute({ sql: dropTriggerSql });
  }

  const ftsTableExists = await connection.execute({
    sql:
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'",
  });
  if (ftsTableExists.rows.length > 0) {
    const ftsColumns = await connection.execute(
      { sql: "PRAGMA table_info(chunks_fts)" },
    );
    const indexesFtsValue = ftsColumns.rows.some((row) =>
      String(row.name) === "fts_value"
    );
    if (!indexesFtsValue) {
      await connection.execute({
        sql: schemaBuilder.buildDropChunksFtsTable(),
      });
    }
  }

  await connection.execute({ sql: schemaBuilder.buildLibsqlChunksFtsTable() });
  for (const triggerSql of schemaBuilder.buildLibsqlChunksTriggers()) {
    await connection.execute({ sql: triggerSql });
  }

  const chunkCount = await connection.execute(
    { sql: "SELECT COUNT(*) AS total FROM chunks" },
  );
  const totalChunks = Number(chunkCount.rows[0]?.total ?? 0);
  if (totalChunks > 0) {
    try {
      await connection.execute({
        sql: schemaBuilder.buildRebuildChunksFtsIndex(),
      });
    } catch {
      // FTS rebuild is best-effort during migration; callers can run rebuildLibsqlSearchIndexFromQuads.
    }
  }
}
