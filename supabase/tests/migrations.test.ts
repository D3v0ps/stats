import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, migrationFiles, type Db } from "./harness";

describe("migrations", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("are numbered consecutively from 0001", () => {
    const numbers = migrationFiles().map((f) => Number(f.slice(0, 4)));
    expect(numbers.length).toBeGreaterThan(5);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("enable RLS on every public table", async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(24);
    expect(res.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("set an empty search_path on every function in public and private", async () => {
    const res = await db.query<{ name: string }>(
      `select n.nspname || '.' || p.proname as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and not coalesce(p.proconfig @> array['search_path=""'], false)
       order by 1`,
    );
    expect(res.rows.map((r) => r.name)).toEqual([]);
  });

  it("give anon no privileges on public tables, sequences or functions", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
       where grantee in ('anon', 'PUBLIC') and table_schema = 'public'`,
    );
    expect(tables.rows).toEqual([]);
    const fns = await db.query<{ name: string }>(
      `select p.proname as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and (has_function_privilege('anon', p.oid, 'execute'))
       order by 1`,
    );
    // The free-plan keep-alive ping is the single exception; it reads no data.
    expect(fns.rows.map((r) => r.name)).toEqual(["keepalive"]);
  });

  it("grant no DELETE or TRUNCATE on facts, uploads, frozen reports or the audit log", async () => {
    const res = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public'
         and privilege_type in ('DELETE', 'TRUNCATE')
         and table_name in ('uploads', 'upload_slices', 'metric_values', 'ledger_balances',
                            'board_reports', 'audit_log', 'app_users')`,
    );
    expect(res.rows).toEqual([]);
  });
});
