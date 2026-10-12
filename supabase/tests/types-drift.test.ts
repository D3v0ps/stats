// src/lib/db/types.ts is hand-written; this test keeps it identical to the migrated
// schema by parsing the TypeScript source and comparing it with the catalogs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "./harness";

const TYPES_PATH = fileURLToPath(new URL("../../src/lib/db/types.ts", import.meta.url));

interface Prop {
  name: string;
  optional: boolean;
  /** Type text without "| null". */
  base: string;
  nullable: boolean;
  node: ts.TypeNode;
}

const source = ts.createSourceFile(
  TYPES_PATH,
  readFileSync(TYPES_PATH, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);

function literal(node: ts.TypeNode): ts.TypeLiteralNode {
  if (!ts.isTypeLiteralNode(node))
    throw new Error(`expected type literal: ${node.getText(source)}`);
  return node;
}

function props(node: ts.TypeNode): Prop[] {
  return literal(node)
    .members.filter(ts.isPropertySignature)
    .map((m) => {
      const type = m.type!;
      const parts = ts.isUnionTypeNode(type) ? [...type.types] : [type];
      const isNull = (t: ts.TypeNode) =>
        ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword;
      return {
        name: (m.name as ts.Identifier).text,
        optional: m.questionToken !== undefined,
        base: parts
          .filter((t) => !isNull(t))
          .map((t) => t.getText(source))
          .join(" | "),
        nullable: parts.some(isNull),
        node: type,
      };
    });
}

function member(node: ts.TypeNode, name: string): ts.TypeNode {
  const found = props(node).find((p) => p.name === name);
  if (!found) throw new Error(`missing member ${name}`);
  return found.node;
}

function stringLiterals(node: ts.TypeNode): string[] {
  if (!ts.isTupleTypeNode(node)) throw new Error(`expected tuple: ${node.getText(source)}`);
  return node.elements.map((e) => {
    if (ts.isLiteralTypeNode(e) && ts.isStringLiteral(e.literal)) return e.literal.text;
    throw new Error(`expected string literal: ${e.getText(source)}`);
  });
}

function databaseType(): ts.TypeNode {
  for (const stmt of source.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === "Database") return stmt.type;
  }
  throw new Error("Database type not found");
}

const schema = member(databaseType(), "public");
const tablesNode = member(schema, "Tables");
const functionsNode = member(schema, "Functions");

const TS_TYPE: Record<string, string> = {
  int2: "number",
  int4: "number",
  int8: "number",
  numeric: "number",
  float8: "number",
  text: "string",
  uuid: "string",
  date: "string",
  timestamptz: "string",
  bytea: "string",
  bool: "boolean",
  jsonb: "Json",
  void: "undefined",
  _int4: "number[]",
  _text: "string[]",
  _date: "string[]",
};

function tsType(udt: string): string {
  const t = TS_TYPE[udt];
  if (!t) throw new Error(`no TypeScript mapping for ${udt}`);
  return t;
}

describe("src/lib/db/types.ts matches the migrations", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("lists exactly the public tables", async () => {
    const res = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    );
    expect(
      props(tablesNode)
        .map((p) => p.name)
        .sort(),
    ).toEqual(res.rows.map((r) => r.table_name));
  });

  it("has every column with the right type, nullability and insert optionality", async () => {
    const res = await db.query<{
      table_name: string;
      column_name: string;
      udt_name: string;
      is_nullable: string;
      has_default: boolean;
      identity_generation: string | null;
    }>(
      `select table_name, column_name, udt_name, is_nullable,
         column_default is not null or is_identity = 'YES' as has_default, identity_generation
       from information_schema.columns where table_schema = 'public'
       order by table_name, column_name`,
    );
    for (const table of props(tablesNode)) {
      const cols = res.rows.filter((r) => r.table_name === table.name);
      const row = props(member(table.node, "Row"));
      const insert = props(member(table.node, "Insert"));
      const update = props(member(table.node, "Update"));
      const names = cols.map((c) => c.column_name);
      expect(row.map((p) => p.name).sort(), `${table.name}.Row`).toEqual(names);
      expect(insert.map((p) => p.name).sort(), `${table.name}.Insert`).toEqual(names);
      expect(update.map((p) => p.name).sort(), `${table.name}.Update`).toEqual(names);

      for (const col of cols) {
        const where = `${table.name}.${col.column_name}`;
        const nullable = col.is_nullable === "YES";
        const r = row.find((p) => p.name === col.column_name)!;
        const i = insert.find((p) => p.name === col.column_name)!;
        const u = update.find((p) => p.name === col.column_name)!;
        expect(
          { type: r.base, nullable: r.nullable, optional: r.optional },
          `${where} Row`,
        ).toEqual({
          type: tsType(col.udt_name),
          nullable,
          optional: false,
        });
        if (col.identity_generation === "ALWAYS") {
          expect({ i: [i.base, i.optional], u: [u.base, u.optional] }, where).toEqual({
            i: ["never", true],
            u: ["never", true],
          });
          continue;
        }
        expect(
          { type: i.base, nullable: i.nullable, optional: i.optional },
          `${where} Insert`,
        ).toEqual({
          type: tsType(col.udt_name),
          nullable,
          optional: nullable || col.has_default,
        });
        expect(
          { type: u.base, nullable: u.nullable, optional: u.optional },
          `${where} Update`,
        ).toEqual({
          type: tsType(col.udt_name),
          nullable,
          optional: true,
        });
      }
    }
  });

  it("declares every foreign key between public tables", async () => {
    const res = await db.query<{
      tbl: string;
      fk: string;
      cols: string[];
      ref: string;
      ref_cols: string[];
    }>(
      `select c.conrelid::regclass::text as tbl, c.conname as fk,
         (select array_agg(a.attname order by k.o) from unnest(c.conkey) with ordinality k(n, o)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as cols,
         replace(c.confrelid::regclass::text, 'public.', '') as ref,
         (select array_agg(a.attname order by k.o) from unnest(c.confkey) with ordinality k(n, o)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) as ref_cols
       from pg_constraint c
       join pg_class rel on rel.oid = c.confrelid
       join pg_namespace n on n.oid = rel.relnamespace
       where c.contype = 'f' and n.nspname = 'public'
         and c.conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
       order by 1, 2`,
    );
    const expected = res.rows.map((r) => ({
      table: r.tbl.replace("public.", ""),
      foreignKeyName: r.fk,
      columns: r.cols,
      referencedRelation: r.ref,
      referencedColumns: r.ref_cols,
    }));
    const declared = props(tablesNode).flatMap((table) => {
      const rels = member(table.node, "Relationships");
      if (!ts.isTupleTypeNode(rels)) throw new Error(`${table.name}.Relationships`);
      return rels.elements.map((el) => {
        const lit = el as ts.TypeNode;
        const str = (name: string) => {
          const n = member(lit, name);
          if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) return n.literal.text;
          throw new Error(`${table.name}.${name}`);
        };
        expect(member(lit, "isOneToOne").getText(source), table.name).toBe("false");
        return {
          table: table.name,
          foreignKeyName: str("foreignKeyName"),
          columns: stringLiterals(member(lit, "columns")),
          referencedRelation: str("referencedRelation"),
          referencedColumns: stringLiterals(member(lit, "referencedColumns")),
        };
      });
    });
    const key = (x: { table: string; foreignKeyName: string }) => `${x.table}.${x.foreignKeyName}`;
    expect(declared.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      expected.sort((a, b) => key(a).localeCompare(key(b))),
    );
  });

  it("declares every RPC with its arguments and result columns", async () => {
    const res = await db.query<{
      name: string;
      arg_names: string[];
      arg_types: string[];
      n_defaults: number;
      retset: boolean;
      ret_type: string;
      out_names: string[] | null;
      out_types: string[] | null;
    }>(
      `select p.proname as name,
         coalesce((select array_agg(p.proargnames[i] order by i) from generate_series(1, p.pronargs) i), '{}') as arg_names,
         coalesce((select array_agg(t.typname order by i) from generate_series(1, p.pronargs) i
            join pg_type t on t.oid = p.proargtypes[i - 1]), '{}') as arg_types,
         p.pronargdefaults::int as n_defaults, p.proretset as retset, rt.typname as ret_type,
         (select array_agg(p.proargnames[i] order by i) from generate_series(1, cardinality(p.proargmodes)) i
            where p.proargmodes[i] = 't') as out_names,
         (select array_agg(t.typname order by i) from generate_series(1, cardinality(p.proargmodes)) i
            join pg_type t on t.oid = p.proallargtypes[i] where p.proargmodes[i] = 't') as out_types
       from pg_proc p join pg_type rt on rt.oid = p.prorettype
       where p.pronamespace = 'public'::regnamespace order by 1`,
    );
    const declared = props(functionsNode);
    expect(declared.map((f) => f.name).sort()).toEqual(res.rows.map((r) => r.name));

    for (const fn of res.rows) {
      const node = declared.find((d) => d.name === fn.name)!.node;
      // supabase-gen writes zero-argument functions as { [_ in never]: never }.
      const argsNode = member(node, "Args");
      const args = ts.isMappedTypeNode(argsNode) ? [] : props(argsNode);
      const expectedArgs = fn.arg_names.map((name, i) => ({
        name,
        type: tsType(fn.arg_types[i]!),
        optional: i >= fn.arg_names.length - fn.n_defaults,
      }));
      expect(
        args
          .map((a) => ({ name: a.name, type: a.base, optional: a.optional }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        `${fn.name} Args`,
      ).toEqual(expectedArgs.sort((a, b) => a.name.localeCompare(b.name)));

      const returns = member(node, "Returns");
      if (fn.retset) {
        expect(ts.isArrayTypeNode(returns), `${fn.name} returns a set`).toBe(true);
        const cols = props((returns as ts.ArrayTypeNode).elementType);
        const expectedCols = (fn.out_names ?? []).map((name, i) => ({
          name,
          type: tsType(fn.out_types![i]!),
        }));
        expect(
          cols
            .map((c) => ({ name: c.name, type: c.base }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          `${fn.name} Returns`,
        ).toEqual(expectedCols.sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        expect(returns.getText(source), `${fn.name} Returns`).toBe(tsType(fn.ret_type));
      }
    }
  });
});
