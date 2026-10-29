import type { SearchRequest } from "@worlds/sdk/search-index";
import {
  buildIncludeExcludeFilterClauses,
  generatePlaceholders,
  sanitizeFtsQuery,
} from "@worlds/sqlite/sql-core";
import type { ColumnMapping } from "@worlds/sqlite/sql-core";
import {
  buildHybridSearchSql,
  buildKeywordSearchSql,
  buildVectorSearchSql,
  validateVectorDimensions,
} from "./libsql-search-sql.ts";

export { sanitizeFtsQuery };

/** CHUNKS_TABLE_COLUMNS maps QuadFilter fields to chunks table column names. */
const CHUNKS_TABLE_COLUMNS: ColumnMapping = {
  subjects: "chunks.subject",
  predicates: "chunks.predicate",
  graphs: "chunks.graph",
};

export class LibsqlSearchQueryBuilder {
  public readonly vectorDimensions: number;

  public constructor(vectorDimensions: number) {
    this.vectorDimensions = validateVectorDimensions(vectorDimensions);
  }

  public buildInsertChunk(insertOptions: {
    quad_id: string;
    subject: string;
    predicate: string;
    graph: string;
    value: string;
    fts_value: string;
    vectorJson?: string | null;
  }): { sql: string; args: (string | number)[] } {
    const hasVector = !!insertOptions.vectorJson;
    const vectorExpr = hasVector ? "vector32(?)" : "NULL";
    const args: (string | number)[] = [
      insertOptions.quad_id,
      insertOptions.subject,
      insertOptions.predicate,
      insertOptions.graph,
      insertOptions.value,
      insertOptions.fts_value,
    ];
    if (hasVector) {
      args.push(insertOptions.vectorJson!);
    }
    return {
      sql:
        `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector)
          VALUES (?, ?, ?, ?, ?, ?, ${vectorExpr})`,
      args,
    };
  }

  public buildDeleteByQuadIds(
    quadIds: string[],
  ): { sql: string; args: string[] } {
    const placeholders = generatePlaceholders(quadIds.length);
    return {
      sql: `DELETE FROM chunks WHERE quad_id IN (${placeholders})`,
      args: quadIds,
    };
  }

  public sanitizeFtsQuery(query: string): string {
    return sanitizeFtsQuery(query);
  }

  public buildSearchQuery(
    request: SearchRequest,
    searchBuildOptions: { vectorJson?: string; limit: number },
  ): { sql: string; args: (string | number)[] } {
    const { vectorJson, limit } = searchBuildOptions;

    const { whereClauses, filterArgs } = buildIncludeExcludeFilterClauses(
      request,
      CHUNKS_TABLE_COLUMNS,
    );

    const whereFilter = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    const hasVector = !!vectorJson;
    const hasQuery = !!request.query && request.query.trim().length > 0;
    const sanitizedQuery = hasQuery ? sanitizeFtsQuery(request.query) : "";
    // A present query with zero searchable tokens (pure punctuation, emoji)
    // must not emit `MATCH ""` — FTS5 crashes on the empty match string.
    const hasKeyword = sanitizedQuery.length > 0;

    if (hasVector && hasKeyword) {
      const args: (string | number)[] = [
        vectorJson!,
        limit,
        sanitizedQuery,
        limit,
        ...filterArgs,
        limit,
      ];

      const sql = buildHybridSearchSql(whereFilter);
      return { sql, args };
    }

    if (hasVector) {
      const args: (string | number)[] = [
        vectorJson!,
        limit,
        ...filterArgs,
        limit,
      ];

      const sql = buildVectorSearchSql(whereFilter);
      return { sql, args };
    }

    if (hasKeyword) {
      const args: (string | number)[] = [
        sanitizedQuery,
        limit,
        ...filterArgs,
        limit,
      ];

      const sql = buildKeywordSearchSql(whereFilter);
      return { sql, args };
    }

    return {
      sql:
        "SELECT NULL as subject, NULL as predicate, NULL as graph, NULL as value, 0 as combined_rank WHERE 0 = 1",
      args: [],
    };
  }
}
