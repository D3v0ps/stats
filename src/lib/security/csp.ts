// The Content-Security-Policy that src/proxy.ts sends with every page, built per request. Next
// reads the nonce from the policy on the incoming request and stamps it on every script it
// renders; 'strict-dynamic' then trusts the chunks those scripts load.

export const CSP_HEADER = "content-security-policy";

// Next only picks up a nonce of this shape (get-script-nonce-from-header.js); anything else
// would also let a value with spaces or ";" add directives.
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export interface CspOptions {
  /** Fresh for every request, from createNonce(). */
  nonce: string;
  /** `next dev`: React's development build evaluates strings. */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL: the browser calls Supabase Auth itself (password change, token refresh). */
  supabaseUrl: string | null;
  /** False on loopback hosts, where a production build is served over plain http (e2e). */
  secureTransport: boolean;
}

/** 16 random bytes, base64. */
export function createNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** True for localhost, *.localhost, 127.0.0.0/8 and ::1, with or without a port (a Host header). */
export function isLoopbackHost(host: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

function httpOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy({
  nonce,
  dev,
  supabaseUrl,
  secureTransport,
}: CspOptions): string {
  if (!NONCE.test(nonce)) throw new Error("CSP nonce must be base64");
  const supabase = httpOrigin(supabaseUrl);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // 'self' only matters to browsers without 'strict-dynamic'.
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // Style attributes (Recharts, Radix, next/image, slide sizes) and the <style> elements of
    // charts, slides, the print page, sonner and Radix cannot carry a nonce. A nonce or hash
    // here would also make browsers ignore 'unsafe-inline'.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'"],
    ["font-src", "'self'"],
    // RSC fetches, server actions and the dev HMR socket are same-origin ('self' covers ws:).
    ["connect-src", "'self'", ...(supabase ? [supabase] : [])],
    // The Turbopack ingest worker is a same-origin script. Without worker-src it would fall
    // back to script-src, where 'strict-dynamic' disables 'self'.
    ["worker-src", "'self'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  // Local Supabase and loopback production builds are plain http.
  if (!dev && secureTransport) directives.push(["upgrade-insecure-requests"]);
  return directives.map((directive) => directive.join(" ")).join("; ");
}
