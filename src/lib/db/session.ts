// Session checks for protected Server Components and Server Actions. src/proxy.ts redirects
// anonymous visitors early, but the proxy is not a security boundary: every protected page and
// action must call requireSession() itself.
import type { JwtPayload } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "./client-server";
import { checkPublicEnv } from "./env";

export const LOGIN_PATH = "/logga-in";

export interface AppSession {
  userId: string;
  email: string | null;
  sessionId: string | null;
  /** Access token expiry, seconds since epoch. */
  expiresAt: number | null;
}

/**
 * The session described by verified JWT claims, or null for anything that is not a signed-in,
 * non-anonymous user. Expiry and signature are already checked by auth.getClaims().
 */
export function sessionFromClaims(claims: JwtPayload | null | undefined): AppSession | null {
  if (!claims || typeof claims.sub !== "string" || claims.sub === "") return null;
  if (claims.role !== "authenticated" || claims.is_anonymous === true) return null;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    sessionId: typeof claims.session_id === "string" ? claims.session_id : null,
    expiresAt: typeof claims.exp === "number" ? claims.exp : null,
  };
}

/** The current session, or null. Deduplicated per request (layout + page share one check). */
export const getSessionOrNull = cache(async (): Promise<AppSession | null> => {
  // Read cookies before anything else so the route is rendered per request even when the
  // Supabase variables are missing (builds must not prerender protected pages).
  await cookies();
  if (!checkPublicEnv().ok) return null;
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return null;
    return sessionFromClaims(data.claims);
  } catch {
    // Auth unreachable or a malformed token: treat as signed out rather than crash the page.
    return null;
  }
});

/** The current session; redirects to /logga-in when there is none. */
export async function requireSession(): Promise<AppSession> {
  const session = await getSessionOrNull();
  if (!session) redirect(LOGIN_PATH);
  return session;
}
