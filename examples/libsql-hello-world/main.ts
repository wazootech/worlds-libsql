import { createClient } from "@libsql/client";
import { createLibsqlClient, LibsqlConnectionDriver } from "@worlds/libsql";
import { LibsqlSchemaBuilder, LibsqlSearchQueryBuilder } from "@worlds/libsql";

if (import.meta.main) {
  const databaseClient = createClient({ url: ":memory:" });
  const client = await createLibsqlClient({
    connection: new LibsqlConnectionDriver(databaseClient),
    schema: new LibsqlSchemaBuilder(32),
    searchQuery: new LibsqlSearchQueryBuilder(32),
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
