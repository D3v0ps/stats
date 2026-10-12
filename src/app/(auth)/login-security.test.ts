import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  LOGIN_ERROR,
  LoginFormSchema,
  MAX_GATE_DELAY_MS,
  MIN_RESPONSE_MS,
  clientIp,
  gateDecision,
  ipHash,
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
  it("allows when the gate allows and nothing remains of a lockout", () => {
    expect(gateDecision({ allowed: true, retry_after_s: 0, delay_ms: 0 })).toEqual({
      allowed: true,
      delayMs: 0,
    });
  });

  it("blocks during a lockout", () => {
    expect(gateDecision({ allowed: false, retry_after_s: 900, delay_ms: 0 }).allowed).toBe(false);
    expect(gateDecision({ allowed: true, retry_after_s: 30, delay_ms: 0 }).allowed).toBe(false);
  });

  it("passes on the global slow-down, capped", () => {
    expect(gateDecision({ allowed: true, retry_after_s: 0, delay_ms: 1200 }).delayMs).toBe(1200);
    expect(gateDecision({ allowed: true, retry_after_s: 0, delay_ms: 99_999 }).delayMs).toBe(
      MAX_GATE_DELAY_MS,
    );
  });

  it("fails closed on anything unexpected", () => {
    for (const raw of [
      null,
      undefined,
      "yes",
      {},
      { allowed: "true", retry_after_s: 0, delay_ms: 0 },
    ]) {
      expect(gateDecision(raw)).toEqual({ allowed: false, delayMs: 0 });
    }
    expect(gateDecision({ allowed: true, retry_after_s: -1, delay_ms: 0 }).allowed).toBe(false);
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
