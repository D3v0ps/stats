import type { JwtPayload } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { LOGIN_PATH, sessionFromClaims } from "./session";

const claims = {
  iss: "https://abcdefgh.supabase.co/auth/v1",
  sub: "11111111-1111-1111-1111-111111111111",
  aud: "authenticated",
  exp: 1_900_000_000,
  iat: 1_800_000_000,
  role: "authenticated",
  aal: "aal1" as const,
  session_id: "22222222-2222-2222-2222-222222222222",
  email: "stats-user@example.invalid",
  is_anonymous: false,
};

describe("sessionFromClaims", () => {
  it("maps verified claims to a session", () => {
    expect(sessionFromClaims(claims)).toEqual({
      userId: claims.sub,
      email: claims.email,
      sessionId: claims.session_id,
      expiresAt: claims.exp,
    });
  });

  it("rejects missing claims, anonymous users and other roles", () => {
    expect(sessionFromClaims(null)).toBeNull();
    expect(sessionFromClaims(undefined)).toBeNull();
    expect(sessionFromClaims({ ...claims, sub: "" })).toBeNull();
    expect(sessionFromClaims({ ...claims, role: "anon" })).toBeNull();
    expect(sessionFromClaims({ ...claims, is_anonymous: true })).toBeNull();
  });

  it("tolerates optional claims being absent", () => {
    const minimal: Partial<typeof claims> = { ...claims };
    delete minimal.email;
    delete minimal.session_id;
    // Older tokens can lack session_id even though the type requires it.
    expect(sessionFromClaims(minimal as unknown as JwtPayload)).toMatchObject({
      email: null,
      sessionId: null,
    });
  });
});

describe("LOGIN_PATH", () => {
  it("is the Swedish login route", () => {
    expect(LOGIN_PATH).toBe("/logga-in");
  });
});
