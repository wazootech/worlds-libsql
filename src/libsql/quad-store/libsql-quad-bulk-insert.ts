const BULK_INSERT_QUAD_COLUMN_COUNT = 10;

export const BULK_INSERT_QUAD_ROWS_PER_STATEMENT = 80;

export interface InsertQuadRow {
  quad_id: string;

  s: string;

  s_type: string;

  p: string;

  o: string;

  o_type: string;

  o_datatype?: string | null;

  o_lang?: string | null;

  g: string;

  g_type: string;
}

export function buildInsertQuad(
  insertQuadOptions: InsertQuadRow,
): { sql: string; args: (string | null)[] } {
  return buildBulkInsertQuads([insertQuadOptions])[0];
}

export function buildBulkInsertQuads(
  insertQuadRows: InsertQuadRow[],
): Array<{ sql: string; args: (string | null)[] }> {
  if (insertQuadRows.length === 0) {
    return [];
  }

  const statements: Array<{ sql: string; args: (string | null)[] }> = [];

  for (
    let rowOffset = 0;
    rowOffset < insertQuadRows.length;
    rowOffset += BULK_INSERT_QUAD_ROWS_PER_STATEMENT
  ) {
    const rowBatch = insertQuadRows.slice(
      rowOffset,
      rowOffset + BULK_INSERT_QUAD_ROWS_PER_STATEMENT,
    );
    const valuePlaceholders = rowBatch
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");
    const args: (string | null)[] = [];

    for (const insertQuadRow of rowBatch) {
      args.push(
        insertQuadRow.quad_id,
        insertQuadRow.s,
        insertQuadRow.s_type,
        insertQuadRow.p,
        insertQuadRow.o,
        insertQuadRow.o_type,
        insertQuadRow.o_datatype ?? null,
        insertQuadRow.o_lang ?? null,
        insertQuadRow.g,
        insertQuadRow.g_type,
      );
    }

    if (
      args.length > BULK_INSERT_QUAD_ROWS_PER_STATEMENT *
          BULK_INSERT_QUAD_COLUMN_COUNT
    ) {
      throw new Error(
        `buildBulkInsertQuads: batch exceeds SQLite host-parameter budget (${args.length})`,
      );
    }

    statements.push({
      sql:
        `INSERT OR REPLACE INTO quads (id, s, s_type, p, o, o_type, o_datatype, o_lang, g, g_type) VALUES ${valuePlaceholders}`,
      args,
    });
  }

  return statements;
}
