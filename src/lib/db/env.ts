// Validated access to the Supabase environment. Values are set by Karim (see .env.example);
// error messages name missing variables but never echo a value.
import { z } from "zod";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const blankAsMissing = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: blankAsMissing(z.url({ protocol: /^https?$/ })),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: blankAsMissing(z.string().trim().min(1)),
});

const ServerEnvSchema = PublicEnvSchema.extend({
  SUPABASE_SECRET_KEY: blankAsMissing(z.string().trim().min(1).optional()),
  STATS_LOGIN_EMAIL: blankAsMissing(z.email()),
});

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface PublicEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface ServerEnv extends PublicEnv {
  /** Service-role key for the login throttle; null when not configured. */
  supabaseSecretKey: string | null;
  /** E-mail of the single Supabase Auth user. */
  loginEmail: string;
}

export type EnvCheck<T> =
  { ok: true; env: T } | { ok: false; missing: string[]; invalid: string[]; message: string };

export class EnvError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
    readonly invalid: string[],
  ) {
    super(message);
    this.name = "EnvError";
  }
}

// Literal property access so Next inlines NEXT_PUBLIC_* values into browser bundles
// (process.env is not enumerable there).
function publicSource(): EnvSource {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

function serverSource(): EnvSource {
  return {
    ...publicSource(),
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    STATS_LOGIN_EMAIL: process.env.STATS_LOGIN_EMAIL,
  };
}

function swedishList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} och ${items.at(-1)}`;
}

/** "MB Stats är inte konfigurerad: X saknas. Y har ett ogiltigt värde. …" */
export function envErrorMessage(missing: string[], invalid: string[]): string {
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`${swedishList(missing)} saknas.`);
  if (invalid.length > 0) {
    parts.push(
      `${swedishList(invalid)} ${invalid.length === 1 ? "har ett ogiltigt värde" : "har ogiltiga värden"}.`,
    );
  }
  return `MB Stats är inte konfigurerad: ${parts.join(" ")} Lägg in värdena som miljövariabler (se .env.example).`;
}

function check<S extends z.ZodObject, T>(
  schema: S,
  source: EnvSource,
  map: (data: z.infer<S>) => T,
): EnvCheck<T> {
  const result = schema.safeParse(source);
  if (result.success) return { ok: true, env: map(result.data) };
  const keys = new Set(result.error.issues.map((issue) => String(issue.path[0])));
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const key of Object.keys(schema.shape)) {
    if (!keys.has(key)) continue;
    if (blankToUndefined(source[key]) === undefined) missing.push(key);
    else invalid.push(key);
  }
  return { ok: false, missing, invalid, message: envErrorMessage(missing, invalid) };
}

export function checkPublicEnv(source: EnvSource = publicSource()): EnvCheck<PublicEnv> {
  return check(PublicEnvSchema, source, (d) => ({
    supabaseUrl: d.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: d.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }));
}

/** Server-only variables included. Never call this from browser code (they are undefined there). */
export function checkServerEnv(source: EnvSource = serverSource()): EnvCheck<ServerEnv> {
  return check(ServerEnvSchema, source, (d) => ({
    supabaseUrl: d.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: d.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: d.SUPABASE_SECRET_KEY ?? null,
    loginEmail: d.STATS_LOGIN_EMAIL,
  }));
}

function unwrap<T>(result: EnvCheck<T>): T {
  if (result.ok) return result.env;
  throw new EnvError(result.message, result.missing, result.invalid);
}

/** @throws EnvError with a Swedish message when the Supabase URL or key is missing. */
export function getPublicEnv(source?: EnvSource): PublicEnv {
  return unwrap(checkPublicEnv(source));
}

/** @throws EnvError with a Swedish message when a required server variable is missing. */
export function getServerEnv(source?: EnvSource): ServerEnv {
  return unwrap(checkServerEnv(source));
}

/** The service-role key, or null when unset or blank. Server only. */
export function getSecretKey(source: EnvSource = serverSource()): string | null {
  const value = blankToUndefined(source.SUPABASE_SECRET_KEY);
  return typeof value === "string" ? value.trim() : null;
}
