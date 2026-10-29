import type { LibsqlQuadPattern } from "./libsql-quad-pattern.ts";
import { buildLibsqlQuadPatternWhereClause } from "./libsql-quad-pattern.ts";

export type {
  LibsqlQuadPattern,
  LibsqlQuadPatternWhereClause,
} from "./libsql-quad-pattern.ts";
export { buildLibsqlQuadPatternWhereClause } from "./libsql-quad-pattern.ts";
export type { InsertQuadRow } from "./libsql-quad-bulk-insert.ts";
export {
  buildBulkInsertQuads,
  buildInsertQuad,
  BULK_INSERT_QUAD_ROWS_PER_STATEMENT,
} from "./libsql-quad-bulk-insert.ts";

export const DEFAULT_LIBSQL_MATCH_PAGE_SIZE = 1000;

export function generatePlaceholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export function buildDeleteQuadsByQuadIds(
  quadIds: string[],
): { sql: string; args: string[] } {
  const placeholders = generatePlaceholders(quadIds.length);
  return {
    sql: `DELETE FROM quads WHERE id IN (${placeholders})`,
    args: quadIds,
  };
}

export function buildSelectExistingQuadIds(
  quadIds: string[],
): { sql: string; args: string[] } {
  const placeholders = generatePlaceholders(quadIds.length);
  return {
    sql: `SELECT id FROM quads WHERE id IN (${placeholders})`,
    args: quadIds,
  };
}

export function buildMatchQuadsQuery(
  pattern: LibsqlQuadPattern,
  pageOptions?: { afterQuadId?: string; limit?: number },
): { sql: string; args: (string | null)[] } {
  const { conditions, args } = buildLibsqlQuadPatternWhereClause(pattern);

  if (pageOptions?.afterQuadId) {
    conditions.push("id > ?");
    args.push(pageOptions.afterQuadId);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  let limitClause = "";
  if (pageOptions?.limit != null) {
    limitClause = " LIMIT ?";
    args.push(String(Math.max(1, Math.floor(pageOptions.limit))));
  }

  return {
    sql:
      `SELECT id, s, s_type, p, o, o_type, o_datatype, o_lang, g, g_type FROM quads ${whereClause} ORDER BY id ASC${limitClause}`,
    args,
  };
}

export function buildCountQuadsQuery(
  pattern: LibsqlQuadPattern,
): { sql: string; args: (string | null)[] } {
  const { conditions, args } = buildLibsqlQuadPatternWhereClause(pattern);
  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  return {
    sql: `SELECT COUNT(*) AS count FROM quads ${whereClause}`,
    args,
  };
}

export function buildWipeAllGraphDataStatements(): Array<
  { sql: string; args: [] }
> {
  return [
    { sql: "DELETE FROM chunks", args: [] },
    { sql: "DELETE FROM quads", args: [] },
  ];
}
