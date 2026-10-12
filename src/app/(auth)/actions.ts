"use server";

import { isAuthApiError } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { checkPublicEnv, checkServerEnv } from "@/lib/db/env";
import { LOGIN_PATH, getSessionOrNull } from "@/lib/db/session";
import {
  LOGIN_CONFIG_ERROR,
  LOGIN_ERROR,
  LOGIN_THROTTLE_CONFIG_ERROR,
  LOGOUT_EVERYWHERE_FAILED_QUERY,
  LoginFormSchema,
  clientIp,
  gateDecision,
  ipHash,
  isAuthCookieName,
  remainingDelay,
  sleep,
  throttleMode,
} from "./login-security";
import type { LoginState } from "./login-state";

type Outcome = "ok" | "rejected" | "config" | "throttle_config";

const MESSAGES: Record<Exclude<Outcome, "ok">, string> = {
  rejected: LOGIN_ERROR,
  config: LOGIN_CONFIG_ERROR,
  throttle_config: LOGIN_THROTTLE_CONFIG_ERROR,
};

async function attemptLogin(formData: FormData): Promise<Outcome> {
  const env = checkServerEnv();
  if (!env.ok) {
    console.error(`[login] ${env.message}`);
    return "config";
  }
  const input = LoginFormSchema.safeParse({ password: formData.get("password") });
  if (!input.success) return "rejected";

  const mode = throttleMode({
    hasSecretKey: env.env.supabaseSecretKey !== null,
    nodeEnv: process.env.NODE_ENV,
  });
  if (mode === "refuse") {
    console.error("[login] SUPABASE_SECRET_KEY is missing in production; login refused.");
    return "throttle_config";
  }
  if (mode === "skip") {
    console.warn(
      "[login] SUPABASE_SECRET_KEY is not set: login throttling is OFF (development only).",
    );
  }

  const admin = mode === "rpc" ? createAdminClient() : null;
  if (mode === "rpc" && !admin) {
    console.error("[login] service-role client unavailable; login refused.");
    return "rejected";
  }
  // login_gate registers the attempt it lets through as pending (counted as a failure), so
  // parallel requests cannot all slip past the gate before any of them is recorded.
  let attemptId: string | null = null;
  if (admin) {
    const hash = ipHash(clientIp(await headers()), env.env.loginEmail);
    const gate = await admin.rpc("login_gate", { p_ip_hash: hash });
    if (gate.error) {
      // Fail closed: without the throttle nobody gets to guess.
      console.error(`[login] login_gate failed (${gate.error.code ?? "unknown"})`);
      return "rejected";
    }
    const decision = gateDecision(gate.data);
    await sleep(decision.delayMs);
    if (!decision.allowed) return "rejected";
    attemptId = decision.attemptId;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: env.env.loginEmail,
    password: input.data.password,
  });
  const ok = error === null;

  // Only answers from the Auth server finalize the attempt. Anything else (network trouble)
  // leaves it pending, where it keeps counting as a failure: the throttle fails closed.
  if (attemptId !== null && admin && (ok || isAuthApiError(error))) {
    const record = await admin.rpc("login_record", { p_attempt_id: attemptId, p_ok: ok });
    if (record.error)
      console.error(`[login] login_record failed (${record.error.code ?? "unknown"})`);
  }
  if (error && !isAuthApiError(error)) console.error(`[login] sign-in failed (${error.name})`);
  return ok ? "ok" : "rejected";
}

/** Single-password login (useActionState). Always takes at least MIN_RESPONSE_MS. */
export async function login(previous: LoginState, formData: FormData): Promise<LoginState> {
  const startedAt = Date.now();
  let outcome: Outcome;
  try {
    outcome = await attemptLogin(formData);
  } catch (error) {
    console.error(
      `[login] unexpected failure (${error instanceof Error ? error.name : "unknown"})`,
    );
    outcome = "rejected";
  }
  await sleep(remainingDelay(startedAt, Date.now()));
  if (outcome === "ok") redirect("/");
  return { error: MESSAGES[outcome], attempt: (previous?.attempt ?? 0) + 1 };
}

/** Expire the Supabase session cookies directly (they are set with path "/"). */
async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (isAuthCookieName(name)) store.delete({ name, path: "/" });
  }
}

/**
 * Sign out with Supabase. When Auth fails (unreachable, refresh error) the client may keep the
 * session, so this browser's cookies are cleared by hand: "Logga ut" must always log out here.
 * Returns whether Auth confirmed the sign-out.
 */
async function signOut(scope: "local" | "global"): Promise<boolean> {
  let confirmed = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope });
    confirmed = error === null;
    if (error) console.error(`[logout] ${scope} sign-out failed (${error.name})`);
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.error(`[logout] ${scope} sign-out failed (${name})`);
  }
  if (!confirmed) await clearAuthCookies();
  return confirmed;
}

/** Sign out this browser only. */
export async function logout(): Promise<void> {
  if (checkPublicEnv().ok) await signOut("local");
  redirect(LOGIN_PATH);
}

/**
 * Sign out every device by revoking all refresh tokens of the shared account. Other devices keep
 * their current access token until it expires (JWT lifetime: 15 minutes in the hosted project,
 * see supabase/config.toml).
 */
export async function logoutEverywhere(): Promise<void> {
  const session = await getSessionOrNull();
  if (session && !(await signOut("global"))) {
    redirect(`${LOGIN_PATH}?${LOGOUT_EVERYWHERE_FAILED_QUERY}`);
  }
  redirect(LOGIN_PATH);
}
