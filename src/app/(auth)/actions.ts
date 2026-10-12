"use server";

import { isAuthApiError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { checkPublicEnv, checkServerEnv } from "@/lib/db/env";
import { LOGIN_PATH, getSessionOrNull } from "@/lib/db/session";
import {
  LOGIN_CONFIG_ERROR,
  LOGIN_ERROR,
  LOGIN_THROTTLE_CONFIG_ERROR,
  LoginFormSchema,
  clientIp,
  gateDecision,
  ipHash,
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
  const hash = ipHash(clientIp(await headers()), env.env.loginEmail);
  if (admin) {
    const gate = await admin.rpc("login_gate", { p_ip_hash: hash });
    if (gate.error) {
      // Fail closed: without the throttle nobody gets to guess.
      console.error(`[login] login_gate failed (${gate.error.code ?? "unknown"})`);
      return "rejected";
    }
    const decision = gateDecision(gate.data);
    await sleep(decision.delayMs);
    if (!decision.allowed) return "rejected";
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: env.env.loginEmail,
    password: input.data.password,
  });
  const ok = error === null;

  // Only answers from the Auth server count as attempts; network trouble is not a guess.
  if (admin && (ok || isAuthApiError(error))) {
    const record = await admin.rpc("login_record", { p_ip_hash: hash, p_ok: ok });
    if (record.error)
      console.error(`[login] login_record failed (${record.error.code ?? "unknown"})`);
  }
  if (error && !isAuthApiError(error)) console.error(`[login] sign-in failed (${error.name})`);
  return ok ? "ok" : "rejected";
}

/** Single-password login (useActionState). Always takes at least MIN_RESPONSE_MS. */
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
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
  return { error: MESSAGES[outcome] };
}

/** Sign out this browser only. */
export async function logout(): Promise<void> {
  if (checkPublicEnv().ok) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect(LOGIN_PATH);
}

/** Sign out every device by revoking all refresh tokens of the shared account. */
export async function logoutEverywhere(): Promise<void> {
  const session = await getSessionOrNull();
  if (session) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "global" });
  }
  redirect(LOGIN_PATH);
}
