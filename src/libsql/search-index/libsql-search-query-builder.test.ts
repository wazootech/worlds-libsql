import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeFtsQuery } from "./libsql-search-query-builder.ts";

test("sanitizeFtsQuery - strips common stopwords while preserving content words", () => {
  assert.deepStrictEqual(
    sanitizeFtsQuery("What is the capital of Aurelia?"),
    `"capital" "aurelia"`,
  );
});

test("sanitizeFtsQuery - preserves original tokens when the query is stopword-only", () => {
  assert.deepStrictEqual(
    sanitizeFtsQuery("what is the"),
    `"what" "is" "the"`,
  );
});

test("sanitizeFtsQuery - keeps Unicode letters (Arabic) for the unicode61 tokenizer", () => {
  assert.deepStrictEqual(
    sanitizeFtsQuery("\u0645\u0631\u062d\u0628\u0627"),
    `"\u0645\u0631\u062d\u0628\u0627"`,
  );
});

test("sanitizeFtsQuery - returns empty for pure punctuation (no searchable tokens)", () => {
  assert.deepStrictEqual(sanitizeFtsQuery("*** ??? !!!"), "");
});
