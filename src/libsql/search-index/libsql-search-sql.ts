/** Reciprocal-rank-fusion search SQL text, moved verbatim from LibsqlSearchQueryBuilder. */

export function buildHybridSearchSql(whereFilter: string): string {
  return `
      WITH vec_matches AS (
        SELECT
          id AS rowid,
          row_number() OVER (PARTITION BY NULL) AS rank_number
        FROM
          vector_top_k('idx_chunks_vector', vector32(?), ?)
      ),
      fts_matches AS (
        SELECT
          rowid,
          row_number() OVER (ORDER BY rank) AS rank_number,
          rank AS score
        FROM
          chunks_fts
        WHERE
          chunks_fts MATCH ?
        LIMIT ?
      ), final AS (
        SELECT
          chunks.subject,
          chunks.predicate,
          chunks.graph,
          chunks.value,
          (
            COALESCE(1.0 / (60 + fts_matches.rank_number), 0.0) * 1.0 + 
            COALESCE(1.0 / (60 + vec_matches.rank_number), 0.0) * 1.0
          ) AS combined_rank
        FROM
          fts_matches
          FULL OUTER JOIN vec_matches ON vec_matches.rowid = fts_matches.rowid
          JOIN chunks ON chunks.id = COALESCE(fts_matches.rowid, vec_matches.rowid)
        ${whereFilter}
        ORDER BY
          combined_rank DESC
        LIMIT ?
      )
      SELECT * FROM final;
    `;
}

export function buildVectorSearchSql(whereFilter: string): string {
  return `
      WITH vec_matches AS (
        SELECT
          id AS rowid,
          row_number() OVER (PARTITION BY NULL) AS rank_number
        FROM
          vector_top_k('idx_chunks_vector', vector32(?), ?)
      ), final AS (
        SELECT
          chunks.subject,
          chunks.predicate,
          chunks.graph,
          chunks.value,
          COALESCE(1.0 / (60 + vec_matches.rank_number), 0.0) AS combined_rank
        FROM
          vec_matches
          JOIN chunks ON chunks.id = vec_matches.rowid
        ${whereFilter}
        ORDER BY
          combined_rank DESC
        LIMIT ?
      )
      SELECT * FROM final;
    `;
}

export function buildKeywordSearchSql(whereFilter: string): string {
  return `
      WITH fts_matches AS (
        SELECT
          rowid,
          row_number() OVER (ORDER BY rank) AS rank_number,
          rank AS score
        FROM
          chunks_fts
        WHERE
          chunks_fts MATCH ?
        LIMIT ?
      ), final AS (
        SELECT
          chunks.subject,
          chunks.predicate,
          chunks.graph,
          chunks.value,
          COALESCE(1.0 / (60 + fts_matches.rank_number), 0.0) AS combined_rank
        FROM
          fts_matches
          JOIN chunks ON chunks.id = fts_matches.rowid
        ${whereFilter}
        ORDER BY
          combined_rank DESC
        LIMIT ?
      )
      SELECT * FROM final;
    `;
}

/** Maximum embedding dimensions accepted by LibsqlSearchQueryBuilder (LibSQL / resource guardrail). */
const LIBSQL_QUERY_BUILDER_MAX_VECTOR_DIMENSIONS = 8192;

export function validateVectorDimensions(vectorDimensions: number): number {
  const dimensions = Math.floor(Number(vectorDimensions));
  if (
    !Number.isFinite(dimensions) ||
    dimensions < 1 ||
    dimensions > LIBSQL_QUERY_BUILDER_MAX_VECTOR_DIMENSIONS
  ) {
    throw new Error(
      `vectorDimensions must be a finite integer in [1, ${LIBSQL_QUERY_BUILDER_MAX_VECTOR_DIMENSIONS}], received: ${
        String(vectorDimensions)
      }`,
    );
  }
  return dimensions;
}
