import type { InStatement } from "@libsql/client";
import type * as rdfjs from "@rdfjs/types";
import { fromRdfjsTerm } from "@worlds/sdk/quad-store";
import {
  buildBulkInsertQuads,
  buildDeleteQuadsByQuadIds,
  buildSelectExistingQuadIds,
} from "./quad-store/libsql-quad-query-builder.ts";
import type { LibsqlConnectionDriver } from "./libsql-connection-driver.ts";
import type { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

/**
 * buildDeletionStatements constructs parameterized deletion statements sweeping facts and vector bounds.
 */
function buildDeletionStatements(
  quadIds: string[],
  queryBuilder: LibsqlSearchQueryBuilder,
): InStatement[] {
  return [
    queryBuilder.buildDeleteByQuadIds(quadIds),
    buildDeleteQuadsByQuadIds(quadIds),
  ];
}

/**
 * buildDeletionStatementsChunked slices large quad id sets into statements of at most `chunkSize` ids.
 */
export function buildDeletionStatementsChunked(
  quadIds: string[],
  queryBuilder: LibsqlSearchQueryBuilder,
  chunkSize: number,
): InStatement[] {
  const statements: InStatement[] = [];
  for (let index = 0; index < quadIds.length; index += chunkSize) {
    const quadIdBatch = quadIds.slice(index, index + chunkSize);
    statements.push(...buildDeletionStatements(quadIdBatch, queryBuilder));
  }
  return statements;
}

/**
 * queryCachePresence polls SQLite to check which Quad IDs have already been fully vectorized and indexed.
 */
export async function queryCachePresence(
  connection: LibsqlConnectionDriver,
  quadIds: string[],
  lookupChunkSize: number,
): Promise<Set<string>> {
  const cachedIds = new Set<string>();
  try {
    for (let i = 0; i < quadIds.length; i += lookupChunkSize) {
      const batchIds = quadIds.slice(i, i + lookupChunkSize);
      const query = buildSelectExistingQuadIds(batchIds);
      const resultSet = await connection.execute(query);
      for (const row of resultSet.rows) {
        if (row.id) {
          cachedIds.add(String(row.id));
        }
      }
    }
  } catch (cause) {
    throw new Error("failed to query existing cache state", { cause });
  }

  return cachedIds;
}

/**
 * buildRelationalStatements decomposes structured Triples into raw SQLite relational columns.
 */
export function buildRelationalStatements(
  quads: rdfjs.Quad[],
  quadIds: string[],
): InStatement[] {
  const insertQuadRows = quads.map((quad, index) => {
    const subject = fromRdfjsTerm(quad.subject);
    const object = fromRdfjsTerm(quad.object);
    const graph = fromRdfjsTerm(quad.graph);

    return {
      quad_id: quadIds[index],
      s: subject.value,
      s_type: subject.termType,
      p: quad.predicate.value,
      o: object.value,
      o_type: object.termType,
      o_datatype: object.datatype,
      o_lang: object.language,
      g: graph.value,
      g_type: graph.termType,
    };
  });

  return buildBulkInsertQuads(insertQuadRows);
}
