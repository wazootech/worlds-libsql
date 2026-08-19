import { assertEquals } from "@std/assert";
import { sanitizeFtsQuery } from "./libsql-search-query-builder.ts";

Deno.test("sanitizeFtsQuery - strips common stopwords while preserving content words", () => {
  assertEquals(
    sanitizeFtsQuery("What is the capital of Aurelia?"),
    `"capital" "aurelia"`,
  );
});

Deno.test("sanitizeFtsQuery - preserves original tokens when the query is stopword-only", () => {
  assertEquals(
    sanitizeFtsQuery("what is the"),
    `"what" "is" "the"`,
  );
});

Deno.test("sanitizeFtsQuery - keeps Unicode letters (Arabic) for the unicode61 tokenizer", () => {
  assertEquals(
    sanitizeFtsQuery("\u0645\u0631\u062d\u0628\u0627"),
    `"\u0645\u0631\u062d\u0628\u0627"`,
  );
});

Deno.test("sanitizeFtsQuery - returns empty for pure punctuation (no searchable tokens)", () => {
  assertEquals(sanitizeFtsQuery("*** ??? !!!"), "");
});
