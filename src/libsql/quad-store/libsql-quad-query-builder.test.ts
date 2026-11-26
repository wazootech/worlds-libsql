import assert from "node:assert/strict";
import { test } from "node:test";
import { DataFactory } from "n3";
import {
  buildBulkInsertQuads,
  buildInsertQuad,
  buildMatchQuadsQuery,
} from "./libsql-quad-query-builder.ts";

const { namedNode, literal } = DataFactory;

test("buildBulkInsertQuads - chunks rows under SQLite host-parameter budget", () => {
  const insertQuadRows = Array.from({ length: 85 }, (_, index) => ({
    quad_id: `id-${index}`,
    s: `urn:s:${index}`,
    s_type: "NamedNode",
    p: "urn:p",
    o: `literal ${index}`,
    o_type: "Literal",
    o_datatype: null,
    o_lang: null,
    g: "",
    g_type: "DefaultGraph",
  }));

  const statements = buildBulkInsertQuads(insertQuadRows);
  assert.deepStrictEqual(statements.length, 2);
  assert.deepStrictEqual(
    (
      statements[0].sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g) ??
      []
    ).length,
    80,
  );
  assert.deepStrictEqual(statements[0].args.length, 800);
  assert.deepStrictEqual(
    (
      statements[1].sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g) ??
      []
    ).length,
    5,
  );
  assert.deepStrictEqual(statements[1].args.length, 50);
});

test("buildBulkInsertQuads - single row matches buildInsertQuad shape", () => {
  const insertQuadRow = {
    quad_id: "quad-hash",
    s: "urn:subject",
    s_type: "NamedNode",
    p: "urn:predicate",
    o: "object text",
    o_type: "Literal",
    o_datatype: "http://www.w3.org/2001/XMLSchema#string",
    o_lang: "en",
    g: "urn:graph",
    g_type: "NamedNode",
  };

  const bulkStatement = buildBulkInsertQuads([insertQuadRow])[0];
  const singleStatement = buildInsertQuad(insertQuadRow);

  assert.deepStrictEqual(bulkStatement.sql, singleStatement.sql);
  assert.deepStrictEqual(bulkStatement.args, singleStatement.args);
});

test("buildMatchQuadsQuery - exact xsd:string literal seek matches the stored datatype IRI", () => {
  const { sql, args } = buildMatchQuadsQuery({
    subject: null,
    predicate: namedNode("http://schema.org/name"),
    object: literal("Caroline"),
    graph: null,
  });

  assert.deepStrictEqual(args[1], "Literal");
  assert.deepStrictEqual(
    sql.includes(
      "(o_datatype IS NULL OR o_datatype = '' OR o_datatype = 'http://www.w3.org/2001/XMLSchema#string')",
    ),
    true,
  );
  assert.deepStrictEqual(sql.includes("o_datatype IS NULL"), true);
});

test("buildMatchQuadsQuery - exact rdf:langString literal seek matches the stored datatype IRI", () => {
  const { sql, args } = buildMatchQuadsQuery({
    subject: null,
    predicate: namedNode("http://schema.org/name"),
    object: literal("Caroline", "en"),
    graph: null,
  });

  assert.deepStrictEqual(args[1], "Literal");
  assert.deepStrictEqual(
    sql.includes(
      "(o_datatype IS NULL OR o_datatype = '' OR o_datatype = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString')",
    ),
    true,
  );
  assert.deepStrictEqual(sql.includes("o_lang = ?"), true);
});

test("buildMatchQuadsQuery - non-string datatype still emits an exact o_datatype seek", () => {
  const { sql, args } = buildMatchQuadsQuery({
    subject: null,
    predicate: namedNode("http://schema.org/age"),
    object: literal(
      "42",
      namedNode("http://www.w3.org/2001/XMLSchema#integer"),
    ),
    graph: null,
  });

  assert.deepStrictEqual(
    sql.includes(
      "(o_datatype IS NULL OR o_datatype = '' OR o_datatype = 'http://www.w3.org/2001/XMLSchema#string')",
    ),
    false,
  );
  assert.deepStrictEqual(sql.includes("o_datatype = ?"), true);
  assert.deepStrictEqual(
    args.includes("http://www.w3.org/2001/XMLSchema#integer"),
    true,
  );
});
