import { assertEquals } from "@std/assert";
import { buildChunkFtsValue } from "./search-chunk-fts.ts";

Deno.test("buildChunkFtsValue - indexes object value text only, ignoring quad surface", () => {
  const ftsValue = buildChunkFtsValue({
    quad_id: "q1",
    subject: "http://example.org/Aurelia",
    predicate: "http://example.org/hasCapital",
    graph: "",
    value: "Lume",
  });

  assertEquals(ftsValue, "Lume");
});

Deno.test("buildChunkFtsValue - subject and predicate IRIs are never searchable", () => {
  const chunk = {
    quad_id: "q2",
    subject: "urn:alice",
    predicate: "urn:activity",
    graph: "",
    value: "sailing",
  };

  assertEquals(buildChunkFtsValue(chunk), "sailing");
  assertEquals(
    buildChunkFtsValue(chunk).includes("alice"),
    false,
    "subject IRI must not leak into the searchable text",
  );
  assertEquals(
    buildChunkFtsValue(chunk).includes("activity"),
    false,
    "predicate IRI must not leak into the searchable text",
  );
});
