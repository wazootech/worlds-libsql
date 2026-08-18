import { createClient } from "@libsql/client";
import { createLibsqlSdk } from "@worlds/libsql";

if (import.meta.main) {
  const databaseClient = createClient({ url: ":memory:" });
  const client = await createLibsqlSdk({
    client: databaseClient,
  });

  await client.import({
    source: {
      kind: "serialized",
      data:
        `<http://example.com/subject> <http://example.com/predicate> "Hello, World!" .`,
      contentType: "text/turtle",
    },
  });

  const searchResponse = await client.search({ query: "Hello" });
  console.log(JSON.stringify(searchResponse, null, 2));

  const sparqlResponse = await client.sparql({
    query: `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
  });
  console.log(JSON.stringify(sparqlResponse, null, 2));
}
