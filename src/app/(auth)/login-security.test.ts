import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  LOGIN_ERROR,
  LOGOUT_EVERYWHERE_FAILED_MESSAGE,
  LOGOUT_EVERYWHERE_FAILED_QUERY,
  LoginFormSchema,
  MAX_GATE_DELAY_MS,
  MIN_RESPONSE_MS,
  clientIp,
  gateDecision,
  ipHash,
  isAuthCookieName,
  loginNotice,
  remainingDelay,
  sleep,
  throttleMode,
} from "./login-security";
import { PASSWORD_MAX_LENGTH } from "./login-state";

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip and then to a constant", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("bounds attacker-controlled header length", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "x".repeat(500) }))).toHaveLength(64);
  });
});

describe("ipHash", () => {
  it("is sha256(ip + ':' + salt) in hex", () => {
    const expected = createHash("sha256").update("203.0.113.7:user@example.invalid").digest("hex");
    expect(ipHash("203.0.113.7", "user@example.invalid")).toBe(expected);
  });

  it("never contains the raw IP and matches the database's ip_hash format", () => {
    const hash = ipHash("203.0.113.7", "salt");
    expect(hash).not.toContain("203.0.113.7");
    // public.login_gate rejects anything else (keeps raw IPs out of the table).
    expect(hash).toMatch(/^[A-Za-z0-9+/=_-]{16,128}$/);
  });

  it("depends on the salt and the IP", () => {
    expect(ipHash("1.2.3.4", "a")).not.toBe(ipHash("1.2.3.4", "b"));
    expect(ipHash("1.2.3.4", "a")).not.toBe(ipHash("1.2.3.5", "a"));
  });
});

describe("gateDecision", () => {
  const ATTEMPT = "3f2c8a8e-5b1d-4c6e-9f7a-2b8d4e6f1a3c";
  const open = { allowed: true, retry_after_s: 0, delay_ms: 0, attempt_id: ATTEMPT };

  it("allows when the gate allows, nothing remains of a lockout and the attempt is registered", () => {
    expect(gateDecision(open)).toEqual({ allowed: true, delayMs: 0, attemptId: ATTEMPT });
  });

  it("blocks during a lockout", () => {
    expect(
      gateDecision({ allowed: false, retry_after_s: 900, delay_ms: 0, attempt_id: null }),
    ).toEqual({ allowed: false, delayMs: 0, attemptId: null });
    expect(gateDecision({ ...open, retry_after_s: 30 }).allowed).toBe(false);
  });

  it("never allows an attempt the gate did not register", () => {
    expect(gateDecision({ ...open, attempt_id: null })).toEqual({
      allowed: false,
      delayMs: 0,
      attemptId: null,
    });
    // The pre-registration shape of login_gate (no attempt_id) fails closed.
    expect(gateDecision({ allowed: true, retry_after_s: 0, delay_ms: 0 }).allowed).toBe(false);
  });

  it("passes on the global slow-down, capped", () => {
    expect(gateDecision({ ...open, delay_ms: 1200 }).delayMs).toBe(1200);
    expect(gateDecision({ ...open, delay_ms: 99_999 }).delayMs).toBe(MAX_GATE_DELAY_MS);
    expect(
      gateDecision({ allowed: false, retry_after_s: 60, delay_ms: 2000, attempt_id: null }).delayMs,
    ).toBe(2000);
  });

  it("fails closed on anything unexpected", () => {
    for (const raw of [
      null,
      undefined,
      "yes",
      {},
      { ...open, allowed: "true" },
      { ...open, attempt_id: "not-a-uuid" },
    ]) {
      expect(gateDecision(raw)).toEqual({ allowed: false, delayMs: 0, attemptId: null });
    }
    expect(gateDecision({ ...open, retry_after_s: -1 }).allowed).toBe(false);
  });
});

describe("throttleMode", () => {
  it("uses the RPCs whenever a secret key exists", () => {
    expect(throttleMode({ hasSecretKey: true, nodeEnv: "production" })).toBe("rpc");
    expect(throttleMode({ hasSecretKey: true, nodeEnv: "development" })).toBe("rpc");
  });

  it("refuses in production and skips in development without a key", () => {
    expect(throttleMode({ hasSecretKey: false, nodeEnv: "production" })).toBe("refuse");
    expect(throttleMode({ hasSecretKey: false, nodeEnv: "development" })).toBe("skip");
    expect(throttleMode({ hasSecretKey: false, nodeEnv: "test" })).toBe("skip");
    expect(throttleMode({ hasSecretKey: false, nodeEnv: undefined })).toBe("skip");
  });
});

describe("remainingDelay / sleep", () => {
  it("pads fast responses up to the minimum", () => {
    expect(remainingDelay(1000, 1100)).toBe(MIN_RESPONSE_MS - 100);
    expect(remainingDelay(1000, 1000 + MIN_RESPONSE_MS + 5)).toBe(0);
    expect(remainingDelay(0, 0, 250)).toBe(250);
  });

  it("sleeps for the requested time", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = sleep(300).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});

describe("LoginFormSchema", () => {
  it("requires a non-empty password within the length limit", () => {
    expect(LoginFormSchema.safeParse({ password: "hemligt" }).success).toBe(true);
    expect(LoginFormSchema.safeParse({ password: "" }).success).toBe(false);
    expect(LoginFormSchema.safeParse({ password: null }).success).toBe(false);
    expect(
      LoginFormSchema.safeParse({ password: "x".repeat(PASSWORD_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });
});

describe("LOGIN_ERROR", () => {
  it("is the agreed generic message", () => {
    expect(LOGIN_ERROR).toBe(
      "Fel lösenord, eller för många försök. Vänta en stund och försök igen.",
    );
  });
});

describe("isAuthCookieName", () => {
  it("matches Supabase session cookies, their chunks and the PKCE verifier", () => {
    for (const name of [
      "sb-abcdefgh-auth-token",
      "sb-abcdefgh-auth-token.0",
      "sb-abcdefgh-auth-token.12",
      "sb-abcdefgh-auth-token-code-verifier",
      "sb-127-auth-token",
    ]) {
      expect(isAuthCookieName(name), name).toBe(true);
    }
  });

  it("leaves every other cookie alone", () => {
    for (const name of ["auth-token", "sb-auth", "sb--auth-token", "x-sb-a-auth-token", "theme"]) {
      expect(isAuthCookieName(name), name).toBe(false);
    }
  });
});

describe("loginNotice", () => {
  it("explains a failed 'Logga ut överallt'", () => {
    const params = Object.fromEntries(new URLSearchParams(LOGOUT_EVERYWHERE_FAILED_QUERY));
    expect(loginNotice(params)).toBe(LOGOUT_EVERYWHERE_FAILED_MESSAGE);
  });

  it("ignores unknown or repeated flags (no reflected text)", () => {
    expect(loginNotice({})).toBeNull();
    expect(loginNotice({ fel: "<script>" })).toBeNull();
    expect(loginNotice({ fel: ["utloggning", "utloggning"] })).toBeNull();
  });
});
