import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvError,
  checkPublicEnv,
  checkServerEnv,
  envErrorMessage,
  getPublicEnv,
  getSecretKey,
  getServerEnv,
} from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  STATS_LOGIN_EMAIL: "stats-user@example.invalid",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkPublicEnv", () => {
  it("accepts a valid configuration", () => {
    expect(checkPublicEnv(valid)).toEqual({
      ok: true,
      env: {
        supabaseUrl: "https://abcdefgh.supabase.co",
        supabasePublishableKey: "sb_publishable_test",
      },
    });
  });

  it("reports missing variables by name, treating blank values as missing", () => {
    const result = checkPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "  " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
    expect(result.invalid).toEqual([]);
    expect(result.message).toBe(
      "MB Stats är inte konfigurerad: NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY saknas. Lägg in värdena som miljövariabler (se .env.example).",
    );
  });

  it("flags an invalid URL without echoing its value", () => {
    const result = checkPublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not a url secret-ish" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.invalid).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(result.message).toContain("NEXT_PUBLIC_SUPABASE_URL har ett ogiltigt värde.");
    expect(result.message).not.toContain("secret-ish");
  });

  it("rejects non-http URLs", () => {
    expect(checkPublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "ftp://x.example" }).ok).toBe(
      false,
    );
  });

  it("reads process.env by default", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", valid.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(checkPublicEnv().ok).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(checkPublicEnv().ok).toBe(false);
  });
});

describe("checkServerEnv", () => {
  it("includes the login e-mail and the optional secret key", () => {
    expect(checkServerEnv(valid)).toEqual({
      ok: true,
      env: {
        supabaseUrl: valid.NEXT_PUBLIC_SUPABASE_URL,
        supabasePublishableKey: valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        supabaseSecretKey: "sb_secret_test",
        loginEmail: valid.STATS_LOGIN_EMAIL,
      },
    });
  });

  it("allows a missing secret key (dev) but not a missing login e-mail", () => {
    const noSecret = checkServerEnv({ ...valid, SUPABASE_SECRET_KEY: "" });
    expect(noSecret.ok && noSecret.env.supabaseSecretKey).toBeNull();
    const noEmail = checkServerEnv({ ...valid, STATS_LOGIN_EMAIL: undefined });
    expect(noEmail.ok).toBe(false);
    if (!noEmail.ok) expect(noEmail.missing).toEqual(["STATS_LOGIN_EMAIL"]);
  });

  it("validates the e-mail", () => {
    const result = checkServerEnv({ ...valid, STATS_LOGIN_EMAIL: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invalid).toEqual(["STATS_LOGIN_EMAIL"]);
  });
});

describe("getPublicEnv / getServerEnv", () => {
  it("return the env or throw EnvError with the Swedish message", () => {
    expect(getServerEnv(valid).loginEmail).toBe(valid.STATS_LOGIN_EMAIL);
    expect(getPublicEnv(valid).supabaseUrl).toBe(valid.NEXT_PUBLIC_SUPABASE_URL);
    try {
      getServerEnv({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const envError = error as EnvError;
      expect(envError.missing).toEqual([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "STATS_LOGIN_EMAIL",
      ]);
      expect(envError.message).toContain(
        "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY och STATS_LOGIN_EMAIL saknas.",
      );
    }
  });
});

describe("getSecretKey", () => {
  it("returns the trimmed key or null", () => {
    expect(getSecretKey({ SUPABASE_SECRET_KEY: " sb_secret_x " })).toBe("sb_secret_x");
    expect(getSecretKey({ SUPABASE_SECRET_KEY: "   " })).toBeNull();
    expect(getSecretKey({})).toBeNull();
  });
});

describe("envErrorMessage", () => {
  it("combines missing and invalid variables", () => {
    expect(envErrorMessage(["A"], ["B", "C"])).toBe(
      "MB Stats är inte konfigurerad: A saknas. B och C har ogiltiga värden. Lägg in värdena som miljövariabler (se .env.example).",
    );
  });
});
