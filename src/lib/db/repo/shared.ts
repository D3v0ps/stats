// Shared plumbing for the repo adapters. Adapters receive a SupabaseClient<Database>
// (created by src/lib/db/client-*.ts) and never create clients themselves.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../types";

export type DbClient = SupabaseClient<Database>;

/** PostgREST caps every response at max_rows (1000 on Supabase). */
export const PAGE_SIZE = 1000;

/** Rows per insert request when staging facts and ledger rows. */
export const STAGE_CHUNK_SIZE = 2000;

interface PostgrestErrorLike {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * A failed database call. The message is the database's (Swedish for our own RPC
 * errors); request payloads are never included.
 */
export class DbError extends Error {
  readonly code: string | null;
  readonly operation: string;

  constructor(operation: string, error: PostgrestErrorLike) {
    super(error.message);
    this.name = "DbError";
    this.code = error.code ?? null;
    this.operation = operation;
  }
}

interface Result<T> {
  data: T | null;
  error: PostgrestErrorLike | null;
}

/** Throw DbError on error, otherwise return data (null data is an error). */
export function unwrap<R extends Result<unknown>>(
  operation: string,
  result: R,
): NonNullable<R["data"]> {
  if (result.error) throw new DbError(operation, result.error);
  if (result.data === null || result.data === undefined) {
    throw new DbError(operation, { message: "Inget svar från databasen" });
  }
  return result.data as NonNullable<R["data"]>;
}

/** Like unwrap, but null data is fine (maybeSingle, void RPCs). */
export function unwrapMaybe<R extends Result<unknown>>(
  operation: string,
  result: R,
): NonNullable<R["data"]> | null {
  if (result.error) throw new DbError(operation, result.error);
  return (result.data ?? null) as NonNullable<R["data"]> | null;
}

/** Throw DbError when a write failed. */
export function check(operation: string, result: { error: PostgrestErrorLike | null }): void {
  if (result.error) throw new DbError(operation, result.error);
}

/**
 * Fetch every row of a query in PAGE_SIZE pages. The query must have a total order,
 * otherwise rows can be skipped or repeated between pages.
 */
export async function fetchAll<T>(
  operation: string,
  page: (from: number, to: number) => PromiseLike<Result<T[]>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows: T[] = unwrap(operation, await page(from, from + PAGE_SIZE - 1));
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`Invalid chunk size: ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Same rules as normalizeValue() in src/lib/core/normalize.ts and
// private.normalize_label() in SQL: NFC, zero-width characters removed, whitespace
// collapsed, trimmed, Swedish lowercase. Keys of the dimension dictionary use it.
const ZERO_WIDTH = /[​-‍⁠]/g;
export function normKey(input: string): string {
  return cleanLabel(input).toLocaleLowerCase("sv");
}

/** Display form of a label, case kept. Mirrors private.clean_label() in SQL. */
export function cleanLabel(input: string): string {
  return input.normalize("NFC").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
}

export function isJsonObject(
  value: Json | undefined,
): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A grouping key from an RPC (jsonb object) as a MonthlyRow-style group record. */
export function toGroup(value: Json): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  if (!isJsonObject(value)) return out;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "number" || typeof v === "string") out[key] = v;
    else if (v === null) out[key] = null;
  }
  return out;
}

/** numeric/bigint values arrive as numbers or (when large) strings. */
export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${String(value)}`);
  return n;
}
