// The local Supabase stack behind the e2e run: its URL and keys, a database reset and the login
// throttle. Every target is checked to be on this machine, so a run can never write to the
// hosted project. Keys and passwords are never printed or put into error messages.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";

/** The single Auth user of the e2e server (.test is a reserved domain, RFC 2606). */
export const E2E_LOGIN_EMAIL = "e2e@mbstats.test";

const ROOT = path.resolve(__dirname, "..", "..");
// URL.hostname keeps the brackets of an IPv6 address.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface LocalSupabase {
  url: string;
  publishableKey: string;
  secretKey: string;
}

// The runner resolves the values once and caches them here; workers inherit process.env.
const ENV_NAMES = {
  url: "E2E_SUPABASE_URL",
  publishableKey: "E2E_SUPABASE_PUBLISHABLE_KEY",
  secretKey: "E2E_SUPABASE_SECRET_KEY",
} as const satisfies Record<keyof LocalSupabase, string>;

const LocalSupabaseSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  publishableKey: z.string().min(1),
  secretKey: z.string().min(1),
});

const StatusSchema = z.object({
  API_URL: z.string(),
  PUBLISHABLE_KEY: z.string(),
  SECRET_KEY: z.string(),
});

/** Throws unless the URL points at this machine. Only the host name appears in the message. */
export function assertLoopback(raw: string, label: string): void {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `${label} points at "${host}". The e2e suite only runs against this machine ` +
        "(127.0.0.1, localhost or ::1).",
    );
  }
}

function supabaseCli(args: string[], opts: { inherit?: boolean; timeoutMs?: number } = {}) {
  const cli = process.env.SUPABASE_CLI || "supabase";
  try {
    return execFileSync(cli, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? 60_000,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Supabase CLI not found: install it or set SUPABASE_CLI to its path.");
    }
    // Output is left out on purpose: `supabase status` prints the keys.
    const status = (error as { status?: number | null }).status;
    throw new Error(`\`supabase ${args.slice(0, 2).join(" ")}\` failed (exit ${status ?? "?"}).`);
  }
}

function validated(candidate: Record<keyof LocalSupabase, string | undefined>, source: string) {
  const parsed = LocalSupabaseSchema.safeParse(candidate);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid local Supabase values from ${source}: ${fields.join(", ")}.`);
  }
  assertLoopback(parsed.data.url, "The Supabase URL");
  return parsed.data;
}

function fromStatus(): LocalSupabase {
  let stdout: string;
  try {
    stdout = supabaseCli(["status", "-o", "json"]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase CLI not found")) throw error;
    throw new Error("Local Supabase is not running: start it with `supabase start`.");
  }
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error("`supabase status -o json` did not print JSON.");
  }
  const status = StatusSchema.safeParse(json);
  if (!status.success) throw new Error("`supabase status -o json` lacks the expected fields.");
  return validated(
    {
      url: status.data.API_URL,
      publishableKey: status.data.PUBLISHABLE_KEY,
      secretKey: status.data.SECRET_KEY,
    },
    "supabase status",
  );
}

/**
 * The local stack's URL and keys: from the E2E_SUPABASE_* variables when they are set (all
 * three), else from `supabase status`. The result is cached in process.env so test workers,
 * which re-import the config, reuse it instead of calling the CLI again. The database reset and
 * the throttle cleanup always go through the CLI's own stack (this repo's supabase/config.toml),
 * so the variables must describe that same stack.
 */
export function resolveLocalSupabase(): LocalSupabase {
  const fromEnv = {
    url: process.env[ENV_NAMES.url],
    publishableKey: process.env[ENV_NAMES.publishableKey],
    secretKey: process.env[ENV_NAMES.secretKey],
  };
  const given = Object.values(fromEnv).filter((v) => v !== undefined && v !== "").length;
  const all = Object.keys(ENV_NAMES).length;
  if (given > 0 && given < all) {
    throw new Error(`Set all of ${Object.values(ENV_NAMES).join(", ")}, or none of them.`);
  }
  const env = given === all ? validated(fromEnv, "E2E_SUPABASE_*") : fromStatus();
  for (const key of Object.keys(ENV_NAMES) as (keyof LocalSupabase)[]) {
    process.env[ENV_NAMES[key]] = env[key];
  }
  return env;
}

/** Recreates the local database from supabase/migrations (never --linked). */
export function resetLocalDatabase(): void {
  supabaseCli(["db", "reset", "--local"], { inherit: true, timeoutMs: 300_000 });
}

function runLocalSql(sql: string): void {
  supabaseCli(["db", "query", "--local", sql]);
}

// `db query -o json` prints a bare array, or { rows } when the CLI thinks an agent runs it.
export const QueryOutputSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ rows: z.array(z.record(z.string(), z.unknown())) }).transform((o) => o.rows),
]);

/** Rows of a query on the LOCAL database. Only for test assertions on non-secret data. */
export function queryLocalSql(sql: string): Record<string, unknown>[] {
  const stdout = supabaseCli(["db", "query", "--local", "-o", "json", sql]);
  return QueryOutputSchema.parse(JSON.parse(stdout));
}

/** Forgets every login attempt, so earlier failures cannot lock out or slow down a login. */
export function clearLoginThrottle(): void {
  runLocalSql("delete from private.login_attempts");
}

/** Waits until Auth and the REST API answer (both restart after a reset). */
export async function waitForLocalSupabase(env: LocalSupabase, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const ok = async (url: string) => {
    try {
      const res = await fetch(url, { headers: { apikey: env.publishableKey } });
      return res.ok;
    } catch {
      return false;
    }
  };
  while (Date.now() < deadline) {
    if ((await ok(`${env.url}/auth/v1/health`)) && (await ok(`${env.url}/rest/v1/`))) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Local Supabase did not become healthy in time.");
}
