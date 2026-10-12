// PGlite test database with Supabase's roles and auth helpers stubbed, plus helpers to
// run statements as a given API role inside a transaction (like PostgREST does).
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";

export type Tx = Transaction;
export type Db = PGlite;

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));
export const MIGRATIONS_DIR = join(TESTS_DIR, "..", "migrations");

/** Migration file names in apply order. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

let template: Promise<Blob> | null = null;

async function buildTemplate(): Promise<Blob> {
  const db = new PGlite();
  await db.exec(readFileSync(join(TESTS_DIR, "stubs.sql"), "utf8"));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      await db.close();
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  const dump = await db.dumpDataDir("none");
  await db.close();
  return dump;
}

/**
 * A fresh database with stubs.sql and every migration applied. Migrations run once per
 * worker; each call starts from a copy of that data directory.
 */
export async function createTestDb(): Promise<Db> {
  template ??= buildTemplate();
  const dump = await template;
  return new PGlite({ loadDataDir: dump });
}

async function withRole<T>(
  db: Db,
  role: "anon" | "authenticated" | "service_role",
  claims: Record<string, unknown>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return fn(tx);
  });
}

/** Run fn as an authenticated user (role authenticated, JWT sub = userId). */
export function asUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRole(
    db,
    "authenticated",
    { sub: userId, role: "authenticated", aud: "authenticated" },
    fn,
  );
}

/** Run fn as the anonymous API role. */
export function asAnon<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRole(db, "anon", { role: "anon" }, fn);
}

/** Run fn as service_role (the server-only secret key). */
export function asService<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRole(db, "service_role", { role: "service_role" }, fn);
}

/** Create an auth user; allowlisted in app_users unless allowlisted is false. */
export async function createAppUser(
  db: Db,
  { allowlisted = true }: { allowlisted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.invalid`]);
  if (allowlisted) await db.query("insert into public.app_users (user_id) values ($1)", [id]);
  return id;
}
