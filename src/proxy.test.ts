import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
// What Next renders with: it must find the proxy's nonce in the policy.
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, isPublicPath, proxy } from "./proxy";

const SUPABASE_URL = "https://abcdefgh.supabase.co";

function stubSupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

function request(
  path: string,
  cookies: Record<string, string> = {},
  base = "https://stats.example.se",
) {
  const req = new NextRequest(new URL(path, base));
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

const isNext = (res: Response) => res.headers.get("x-middleware-next") === "1";
const location = (res: Response) => {
  const value = res.headers.get("location");
  return value ? new URL(value).pathname : null;
};

const CSP = "content-security-policy";
const directive = (policy: string, name: string) =>
  policy
    .split("; ")
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.split(" ")
    .slice(1);

/** A pass-through whose policy the browser enforces and whose nonce Next stamps on scripts. */
function expectCsp(res: Response): string {
  expect(isNext(res)).toBe(true);
  const policy = res.headers.get(CSP) ?? "";
  expect(policy).toMatch(/^default-src 'self'; script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  // Next renders with the request headers, which reach it only through these overrides.
  expect(res.headers.get("x-middleware-override-headers")?.split(",")).toContain(CSP);
  expect(res.headers.get(`x-middleware-request-${CSP}`)).toBe(policy);
  const nonce = getScriptNonceFromHeader(policy);
  expect(nonce).toBeDefined();
  expect(policy).toContain(`'nonce-${nonce}'`);
  return policy;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isPublicPath", () => {
  it.each([
    "/logga-in",
    "/delad",
    "/delad/abc123",
    "/_next/static/chunks/app.js",
    "/_next/data/build/index.json",
    "/brand/Logo_WHITE-PRIMARY_MB-Miljonbemanning_2024.png",
    "/favicon.ico",
    "/robots.txt",
    "/fonts/x.woff2",
  ])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/utforska",
    "/ladda-upp",
    "/rapporter",
    "/installningar",
    "/designsystem",
    "/deladx",
  ])("%s needs a session", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("matcher", () => {
  it.each([
    ["/", true],
    ["/utforska", true],
    ["/logga-in", true],
    ["/delad/abc", true],
    ["/_next/static/chunks/main.js", false],
    ["/_next/image?url=%2Fbrand%2Flogo.png&w=256&q=75", false],
    ["/brand/logo.png", false],
    ["/favicon.ico", false],
    ["/robots.txt", false],
    ["/some/file.svg", false],
  ] as const)("%s -> %s", (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });
});

describe("proxy without Supabase configuration", () => {
  it("sends protected routes to the login page instead of crashing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const res = await proxy(request("/utforska?bolag=MBAB"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://stats.example.se/logga-in");
  });

  it("lets the login page render its configuration notice", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const policy = expectCsp(await proxy(request("/logga-in")));
    expect(directive(policy, "connect-src")).toEqual(["'self'"]);
  });

  it("still sends the policy on public paths", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expectCsp(await proxy(request("/delad/token")));
  });
});

describe("proxy with Supabase configured", () => {
  it("lets anonymous visitors open share links and assets", async () => {
    stubSupabaseEnv();
    expectCsp(await proxy(request("/delad/token")));
    expect(isNext(await proxy(request("/brand/x.png")))).toBe(true);
  });

  it("redirects anonymous visitors to /logga-in", async () => {
    stubSupabaseEnv();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await proxy(request("/rapporter"));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/logga-in");
    // No session cookie: nothing to verify, so no network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the login page to anonymous visitors", async () => {
    stubSupabaseEnv();
    const policy = expectCsp(await proxy(request("/logga-in")));
    expect(directive(policy, "connect-src")).toEqual(["'self'", SUPABASE_URL]);
  });

  describe("Content-Security-Policy", () => {
    it("uses a fresh nonce for every request", async () => {
      stubSupabaseEnv();
      const nonces = new Set<string | undefined>();
      for (let i = 0; i < 5; i++) {
        nonces.add(getScriptNonceFromHeader(expectCsp(await proxy(request("/logga-in")))));
      }
      expect(nonces.size).toBe(5);
    });

    it("replaces a policy the client sent", async () => {
      stubSupabaseEnv();
      const req = request("/logga-in");
      req.headers.set(CSP, "script-src 'nonce-chosenbytheclient'");
      expect(expectCsp(await proxy(req))).not.toContain("chosenbytheclient");
    });

    it("is strict in production and still works over plain http", async () => {
      stubSupabaseEnv();
      vi.stubEnv("NODE_ENV", "production");
      // next start opened through its network address: upgrading would send /_next/static to https.
      const policy = expectCsp(await proxy(request("/logga-in", {}, "http://192.168.1.20:3000")));
      expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
      expect(directive(policy, "upgrade-insecure-requests")).toBeUndefined();
    });

    it("allows eval in development", async () => {
      stubSupabaseEnv();
      vi.stubEnv("NODE_ENV", "development");
      const policy = expectCsp(await proxy(request("/logga-in")));
      expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
    });
  });

  describe("signed in", () => {
    const now = Math.floor(Date.now() / 1000);
    const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = {
      iss: `${SUPABASE_URL}/auth/v1`,
      sub: "11111111-1111-1111-1111-111111111111",
      aud: "authenticated",
      exp: now + 3600,
      iat: now,
      role: "authenticated",
      aal: "aal1",
      session_id: "22222222-2222-2222-2222-222222222222",
      is_anonymous: false,
    };
    const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.c2lnbmF0dXJl`;
    const user = {
      id: claims.sub,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    };
    const sessionCookie = {
      "sb-abcdefgh-auth-token": `base64-${b64url({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "refresh-token",
        user,
      })}`,
    };

    function stubAuthServer() {
      // HS256 tokens are verified by asking the Auth server for the user.
      const authServer = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/auth/v1/user")) {
          return new Response(JSON.stringify(user), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      });
      vi.stubGlobal("fetch", authServer);
      return authServer;
    }

    it("passes share links and assets through without verifying the session", async () => {
      stubSupabaseEnv();
      // The Auth server would accept the session, so only the public-path short-circuit keeps
      // the proxy from asking it.
      const authServer = stubAuthServer();
      expectCsp(await proxy(request("/delad/token", sessionCookie)));
      expect(isNext(await proxy(request("/brand/x.png", sessionCookie)))).toBe(true);
      expect(authServer).not.toHaveBeenCalled();
    });

    it("lets signed-in users through to protected pages", async () => {
      stubSupabaseEnv();
      stubAuthServer();
      expectCsp(await proxy(request("/utforska", sessionCookie)));
    });

    it("sends signed-in users away from the login page", async () => {
      stubSupabaseEnv();
      stubAuthServer();
      const res = await proxy(request("/logga-in", sessionCookie));
      expect(res.status).toBe(307);
      expect(location(res)).toBe("/");
    });

    const expiredCookie = (accessTokenValue: string) => ({
      "sb-abcdefgh-auth-token": `base64-${b64url({
        access_token: accessTokenValue,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now - 60,
        refresh_token: "old-refresh-token",
        user,
      })}`,
    });

    it("refreshes an expired session and carries the new cookies onto a redirect", async () => {
      stubSupabaseEnv();
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
          return Response.json({
            access_token: accessToken,
            token_type: "bearer",
            expires_in: 3600,
            expires_at: now + 3600,
            refresh_token: "new-refresh-token",
            user,
          });
        }
        if (url.endsWith("/auth/v1/user")) return Response.json(user);
        return new Response("{}", { status: 404 });
      });
      vi.stubGlobal("fetch", fetchSpy);

      const res = await proxy(request("/logga-in", expiredCookie("expired.token.sig")));
      expect(location(res)).toBe("/");
      const refreshed = res.headers.getSetCookie().find((c) => c.startsWith("sb-abcdefgh"));
      expect(refreshed).toBeDefined();
      const value = decodeURIComponent(refreshed!.split(";")[0]!.split("=").slice(1).join("="));
      expect(Buffer.from(value.replace(/^base64-/, ""), "base64url").toString()).toContain(
        "new-refresh-token",
      );
      // Responses that set auth cookies must never be cached by a CDN.
      expect(res.headers.get("cache-control")).toMatch(/no-store/);
    });

    it("keeps the policy on the response that carries refreshed cookies", async () => {
      stubSupabaseEnv();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input instanceof Request ? input.url : input);
          if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
            return Response.json({
              access_token: accessToken,
              token_type: "bearer",
              expires_in: 3600,
              expires_at: now + 3600,
              refresh_token: "new-refresh-token",
              user,
            });
          }
          if (url.endsWith("/auth/v1/user")) return Response.json(user);
          return new Response("{}", { status: 404 });
        }),
      );
      // setAll replaces the response; the page must still render with the policy it carries.
      const res = await proxy(request("/utforska", expiredCookie("expired.token.sig")));
      expectCsp(res);
      const refreshed = res.headers.getSetCookie().find((c) => c.startsWith("sb-abcdefgh"));
      expect(refreshed).toBeDefined();
      expect(res.headers.get("x-middleware-request-cookie")).toContain(refreshed!.split(";")[0]);
    });

    it("clears a revoked session's cookies on the way to /logga-in", async () => {
      stubSupabaseEnv();
      // auth-js warns about the dead refresh token; Next's console patch cannot run in Vitest.
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" },
            { status: 400 },
          ),
        ),
      );
      const res = await proxy(request("/utforska", expiredCookie("expired.token.sig")));
      expect(location(res)).toBe("/logga-in");
      const cleared = res.headers.getSetCookie().find((c) => c.startsWith("sb-abcdefgh"));
      expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    });

    it("treats a token the Auth server rejects as signed out", async () => {
      stubSupabaseEnv();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(JSON.stringify({ code: 401, msg: "bad jwt" }), { status: 401 }),
        ),
      );
      const res = await proxy(request("/utforska", sessionCookie));
      expect(location(res)).toBe("/logga-in");
    });
  });
});
