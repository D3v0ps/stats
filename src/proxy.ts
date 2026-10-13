// Next 16 proxy (formerly middleware): sets the per-request Content-Security-Policy, keeps the
// Supabase session cookies fresh and sends anonymous visitors to /logga-in. Not a security
// boundary: protected pages and actions still call requireSession() themselves.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkPublicEnv } from "@/lib/db/env";
import { LOGIN_PATH, sessionFromClaims } from "@/lib/db/session";
import { buildContentSecurityPolicy, createNonce, CSP_HEADER } from "@/lib/security/csp";

const PUBLIC_EXACT = new Set([
  LOGIN_PATH,
  "/delad",
  "/favicon.ico",
  "/robots.txt",
  // Vercel Cron keep-alive; checks CRON_SECRET itself and returns no data.
  "/api/keepalive",
]);
const PUBLIC_PREFIXES = ["/delad/", "/_next/", "/brand/"];
const STATIC_FILE =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|css|js|map|txt|xml|webmanifest)$/i;

/** Paths reachable without a session: the login page, share links and static assets. */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_EXACT.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    STATIC_FILE.test(pathname)
  );
}

function redirectTo(request: NextRequest, pathname: string, refreshed?: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const response = NextResponse.redirect(url);
  // Carry refreshed session cookies (and their no-store headers) over to the redirect.
  if (refreshed) {
    for (const cookie of refreshed.cookies.getAll()) response.cookies.set(cookie);
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = refreshed.headers.get(header);
      if (value) response.headers.set(header, value);
    }
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === LOGIN_PATH;
  const env = checkPublicEnv();

  const policy = buildContentSecurityPolicy({
    nonce: createNonce(),
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: env.ok ? env.env.supabaseUrl : null,
  });
  // Next reads the nonce from the request's policy (forwarded by NextResponse.next({ request }))
  // and stamps it on its scripts; the browser enforces the copy on the response. Redirects need
  // none: the browser fetches their target with a fresh nonce.
  request.headers.set(CSP_HEADER, policy);
  const passThrough = () => {
    const response = NextResponse.next({ request });
    response.headers.set(CSP_HEADER, policy);
    return response;
  };

  if (!isLogin && isPublicPath(pathname)) return passThrough();

  if (!env.ok) {
    // Nothing can be authenticated without Supabase: the login page explains what is missing.
    return isLogin ? passThrough() : redirectTo(request, LOGIN_PATH);
  }

  let response = passThrough();
  const supabase = createServerClient(env.env.supabaseUrl, env.env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = passThrough();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Verifies the JWT and refreshes an expiring session through setAll above. Nothing may run
  // between creating the client and this call.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = sessionFromClaims(data?.claims) !== null;
  } catch {
    signedIn = false;
  }

  if (!signedIn && !isLogin) return redirectTo(request, LOGIN_PATH, response);
  if (signedIn && isLogin) return redirectTo(request, "/", response);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|brand/|favicon\\.ico|robots\\.txt|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|css|js|map|txt|xml|webmanifest)$).*)",
  ],
};
