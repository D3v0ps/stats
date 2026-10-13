import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, createNonce, type CspOptions } from "./csp";

// The source pattern Next extracts the nonce with (get-script-nonce-from-header.js).
const NEXT_NONCE_SOURCE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

const PROD: CspOptions = {
  nonce: "AAECAwQFBgcICQoLDA0ODw==",
  dev: false,
  supabaseUrl: "https://abcdefgh.supabase.co",
};

function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

describe("createNonce", () => {
  it("is 16 random bytes in base64, in the shape Next reads", () => {
    const nonce = createNonce();
    expect(atob(nonce)).toHaveLength(16);
    expect(`'nonce-${nonce}'`).toMatch(NEXT_NONCE_SOURCE);
  });

  it("is fresh every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(nonces.size).toBe(50);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("is the strict production policy", () => {
    expect(buildContentSecurityPolicy(PROD)).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-AAECAwQFBgcICQoLDA0ODw==' 'strict-dynamic'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self' https://abcdefgh.supabase.co",
        "worker-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  });

  it("allows eval only for React's dev build", () => {
    const dev = directives(buildContentSecurityPolicy({ ...PROD, dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(directives(buildContentSecurityPolicy(PROD)).get("script-src")).not.toContain(
      "'unsafe-eval'",
    );
  });

  it("puts no nonce or hash next to 'unsafe-inline' in style-src", () => {
    expect(directives(buildContentSecurityPolicy(PROD)).get("style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  it("allows same-origin workers explicitly", () => {
    expect(directives(buildContentSecurityPolicy(PROD)).get("worker-src")).toEqual(["'self'"]);
  });

  it.each([
    ["http://127.0.0.1:54321", "http://127.0.0.1:54321"],
    ["http://[::1]:54321", "http://[::1]:54321"],
    ["https://abcdefgh.supabase.co/", "https://abcdefgh.supabase.co"],
    ["https://abcdefgh.supabase.co/rest/v1?x=1", "https://abcdefgh.supabase.co"],
  ])("lets the browser reach Supabase at the origin of %s", (supabaseUrl, origin) => {
    const policy = buildContentSecurityPolicy({ ...PROD, supabaseUrl });
    expect(directives(policy).get("connect-src")).toEqual(["'self'", origin]);
  });

  it.each([
    null,
    "",
    "not a url",
    "ftp://files.example.se",
    "javascript:alert(1)",
    // URL keeps these in the host name; in the header they would start a directive or a policy.
    "https://x;sandbox",
    "https://a.supabase.co%3Bsandbox",
    "https://a.supabase.co,evil.com",
  ])("falls back to same-origin connections for Supabase URL %j", (supabaseUrl) => {
    const policy = buildContentSecurityPolicy({ ...PROD, supabaseUrl });
    expect(directives(policy).get("connect-src")).toEqual(["'self'"]);
  });

  it.each(["", "abc def", "abc;script-src *", "'abc'"])(
    "refuses nonce %j, which could change the policy",
    (nonce) => {
      expect(() => buildContentSecurityPolicy({ ...PROD, nonce })).toThrow();
    },
  );
});
