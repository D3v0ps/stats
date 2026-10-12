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

const NOTICE_PARAM = "fel";
const LOGOUT_EVERYWHERE_FAILED = "utloggning";
/** Query on /logga-in after "Logga ut överallt" could not revoke the other sessions. */
export const LOGOUT_EVERYWHERE_FAILED_QUERY = `${NOTICE_PARAM}=${LOGOUT_EVERYWHERE_FAILED}`;
export const LOGOUT_EVERYWHERE_FAILED_MESSAGE =
  "Alla enheter kunde inte loggas ut. Den här webbläsaren är utloggad. Logga in och försök igen.";

/** The notice for a known ?fel= flag on /logga-in. Anything else in the URL is ignored. */
export function loginNotice(params: Record<string, string | string[] | undefined>): string | null {
  return params[NOTICE_PARAM] === LOGOUT_EVERYWHERE_FAILED
    ? LOGOUT_EVERYWHERE_FAILED_MESSAGE
    : null;
}

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
  attempt_id: z.string().uuid().nullable(),
});

export type GateDecision =
  | {
      allowed: true;
      delayMs: number;
      /** The pending attempt login_gate registered; finalize it with login_record. */
      attemptId: string;
    }
  | { allowed: false; delayMs: number; attemptId: null };

const CLOSED: GateDecision = { allowed: false, delayMs: 0, attemptId: null };

/**
 * Interpret public.login_gate's jsonb. Anything unexpected fails closed (no attempt allowed).
 * An attempt is allowed only when the gate says so, no lockout time remains and the gate
 * registered the attempt (an attempt_id to finalize), so every tried password is counted.
 */
export function gateDecision(raw: unknown): GateDecision {
  const parsed = LoginGateSchema.safeParse(raw);
  if (!parsed.success) return CLOSED;
  const { allowed, retry_after_s, delay_ms, attempt_id } = parsed.data;
  const delayMs = Math.min(delay_ms, MAX_GATE_DELAY_MS);
  if (!allowed || retry_after_s !== 0 || attempt_id === null) {
    return { allowed: false, delayMs, attemptId: null };
  }
  return { allowed: true, delayMs, attemptId: attempt_id };
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

/** Supabase session cookies: sb-<ref>-auth-token, its chunks (.0, .1) and the PKCE verifier. */
export function isAuthCookieName(name: string): boolean {
  return /^sb-.+-auth-token(?:-code-verifier)?(?:\.\d+)?$/.test(name);
}

export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
