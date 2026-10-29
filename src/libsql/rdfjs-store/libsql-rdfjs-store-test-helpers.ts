import type { createClient } from "@libsql/client";
import { LibsqlConnectionDriver } from "@/libsql/libsql-connection-driver.ts";
import { LibsqlRdfjsStore } from "./mod.ts";
import { testLibsqlSchemaBuilder } from "@/libsql/libsql-test-fixtures.ts";

export function createTestLibsqlRdfjsStore(
  client: ReturnType<typeof createClient>,
  matchPageSize?: number,
): LibsqlRdfjsStore {
  return new LibsqlRdfjsStore({
    connection: new LibsqlConnectionDriver(client),
    matchPageSize,
  });
}

export async function setupSchema(
  db: ReturnType<typeof createClient>,
): Promise<void> {
  await db.execute(testLibsqlSchemaBuilder.buildLibsqlQuadsTable());
  for (const ddl of testLibsqlSchemaBuilder.buildIndexes()) {
    await db.execute(ddl);
  }
}

export interface SeedQuadOptions {
  id: string;
  s: string;
  s_type?: string;
  p: string;
  o: string;
  o_type?: string;
  o_datatype?: string | null;
  o_lang?: string | null;
  g?: string;
  g_type?: string;
}

export async function seedQuad(
  db: ReturnType<typeof createClient>,
  options: SeedQuadOptions,
): Promise<void> {
  await db.execute({
    sql:
      `INSERT INTO quads (id, s, s_type, p, o, o_type, o_datatype, o_lang, g, g_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      options.id,
      options.s,
      options.s_type ?? "NamedNode",
      options.p,
      options.o,
      options.o_type ?? "Literal",
      options.o_datatype ?? null,
      options.o_lang ?? null,
      options.g ?? "",
      options.g_type ?? "DefaultGraph",
    ],
  });
}
