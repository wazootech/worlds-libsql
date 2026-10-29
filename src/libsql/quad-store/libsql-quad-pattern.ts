import type * as rdfjs from "@rdfjs/types";

const rdfLangStringIri =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";

const xsdStringIri = "http://www.w3.org/2001/XMLSchema#string";

export interface LibsqlQuadPattern {
  subject: rdfjs.Term | null;

  predicate: rdfjs.Term | null;

  object: rdfjs.Term | null;

  graph: rdfjs.Term | null;
}

export interface LibsqlQuadPatternWhereClause {
  conditions: string[];

  args: (string | null)[];
}

export function buildLibsqlQuadPatternWhereClause(
  pattern: LibsqlQuadPattern,
): LibsqlQuadPatternWhereClause {
  const conditions: string[] = [];
  const args: (string | null)[] = [];

  appendTermCondition(conditions, args, "s", "s_type", pattern.subject);
  appendTermCondition(conditions, args, "o", "o_type", pattern.object);

  if (pattern.predicate) {
    conditions.push("p = ?");
    args.push(pattern.predicate.value);
  }

  appendTermCondition(conditions, args, "g", "g_type", pattern.graph);

  return { conditions, args };
}

function appendTermCondition(
  conditions: string[],
  args: (string | null)[],
  valueColumn: string,
  typeColumn: string,
  term: rdfjs.Term | null,
): void {
  if (!term) return;

  conditions.push(`${valueColumn} = ?`);
  args.push(term.value);

  conditions.push(`${typeColumn} = ?`);
  args.push(term.termType);

  if (term.termType === "Literal") {
    const literalTerm = term as rdfjs.Literal;
    if (literalTerm.language) {
      conditions.push(`o_lang = ?`);
      args.push(literalTerm.language);
    }
    if (literalTerm.datatype) {
      const datatypeValue = literalTerm.datatype.value;
      if (datatypeValue === xsdStringIri) {
        conditions.push(
          `(o_datatype IS NULL OR o_datatype = '' OR o_datatype = '${xsdStringIri}')`,
        );
      } else if (datatypeValue === rdfLangStringIri) {
        conditions.push(
          `(o_datatype IS NULL OR o_datatype = '' OR o_datatype = '${rdfLangStringIri}')`,
        );
      } else {
        conditions.push(`o_datatype = ?`);
        args.push(datatypeValue);
      }
    }
  }
}
