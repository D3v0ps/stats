// Pure pieces of the single-password login: input validation, IP hashing for the throttle,
// interpreting login_gate and constant-ish response timing. No raw IP is ever stored or logged.
import { createHash } from "node:crypto";
import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "./login-state";

/** The only failure message the login form ever shows for credentials or throttling. */
export const LOGIN_ERROR = "Fel lösenord, eller för många försök. Vänta en stund och försök igen.";
export const LOGIN_CONFIG_ERROR =
  "Inloggningen är inte konfigurerad. Be administratören lägga in miljövariablerna för Supabase.";
export const LOGIN_THROTTLE_CONFIG_ERROR =
  "Inloggningen är avstängd: SUPABASE_SECRET_KEY saknas i produktionsmiljön, så spärren mot upprepade försök kan inte köras.";

/** Every response takes at least this long, so timing does not reveal why a login failed. */
export const MIN_RESPONSE_MS = 500;
/** Upper bound for the global slow-down requested by login_gate. */
export const MAX_GATE_DELAY_MS = 3000;

export const LoginFormSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/** First x-forwarded-for entry (set by Vercel's edge), else x-real-ip, else "unknown". */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  // Header values are attacker-controlled: bound the length before hashing.
  return candidate ? candidate.slice(0, 64) : "unknown";
}

/** sha256(ip + ":" + salt) as hex. The salt is STATS_LOGIN_EMAIL, so hashes are per deployment. */
export function ipHash(ip: string, salt: string): string {
  return createHash("sha256").update(`${ip}:${salt}`).digest("hex");
}

const LoginGateSchema = z.object({
  allowed: z.boolean(),
  retry_after_s: z.number().int().nonnegative(),
  delay_ms: z.number().int().nonnegative(),
});

export interface GateDecision {
  allowed: boolean;
  delayMs: number;
}

/**
 * Interpret public.login_gate's jsonb. Anything unexpected fails closed (no attempt allowed).
 * An attempt is allowed only when the gate says so and no lockout time remains.
 */
export function gateDecision(raw: unknown): GateDecision {
  const parsed = LoginGateSchema.safeParse(raw);
  if (!parsed.success) return { allowed: false, delayMs: 0 };
  const { allowed, retry_after_s, delay_ms } = parsed.data;
  return {
    allowed: allowed && retry_after_s === 0,
    delayMs: Math.min(delay_ms, MAX_GATE_DELAY_MS),
  };
}

export type ThrottleMode = "rpc" | "skip" | "refuse";

/**
 * With a service-role key the throttle RPCs run. Without one, production refuses to log anyone
 * in (an unthrottled password login is not acceptable) and development skips the throttle.
 */
export function throttleMode(input: {
  hasSecretKey: boolean;
  nodeEnv: string | undefined;
}): ThrottleMode {
  if (input.hasSecretKey) return "rpc";
  return input.nodeEnv === "production" ? "refuse" : "skip";
}

/** Milliseconds still to wait so the whole attempt lasts at least `minMs`. */
export function remainingDelay(startedAt: number, now: number, minMs = MIN_RESPONSE_MS): number {
  return Math.max(0, startedAt + minMs - now);
}

export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
