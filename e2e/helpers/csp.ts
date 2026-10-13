// Content-Security-Policy checks. Every test's browser context records the
// securitypolicyviolation events of all its pages (popups such as the notes window included),
// and the test fails when there is any. bypassCSP stays off: the suite must see the policy the
// browser really enforces.
import type { BrowserContext } from "@playwright/test";

export interface CspViolation {
  directive: string;
  blocked: string;
  source: string;
  line: number;
  page: string;
}

const BINDING = "__e2eCspViolation";

/** Starts recording; the returned array fills as violations happen. */
export async function recordCspViolations(context: BrowserContext): Promise<CspViolation[]> {
  const violations: CspViolation[] = [];
  await context.exposeBinding(BINDING, ({ page }, v: Omit<CspViolation, "page">) => {
    violations.push({ ...v, page: page ? new URL(page.url()).pathname : "" });
  });
  await context.addInitScript((binding) => {
    window.addEventListener(
      "securitypolicyviolation",
      (e) => {
        const report = (window as unknown as Record<string, (v: unknown) => void>)[binding];
        report?.({
          directive: e.effectiveDirective,
          blocked: e.blockedURI,
          source: e.sourceFile,
          line: e.lineNumber,
        });
      },
      true,
    );
  }, BINDING);
  return violations;
}

export function formatCspViolations(violations: readonly CspViolation[]): string {
  const lines = violations.map(
    (v) =>
      `- ${v.directive} blocked ${v.blocked || "(inline)"} on ${v.page}` +
      (v.source ? ` (${v.source}:${v.line})` : ""),
  );
  return `${violations.length} Content-Security-Policy violation(s):\n${lines.join("\n")}`;
}

// Next only takes a nonce of this shape from the policy (get-script-nonce-from-header.js).
const NONCE_IN_POLICY = /'nonce-([A-Za-z0-9+/_-]+={0,2})'/;

/** The nonce of a response's policy, or null when it has none. */
export function policyNonce(policy: string | undefined): string | null {
  return policy ? (NONCE_IN_POLICY.exec(policy)?.[1] ?? null) : null;
}

/**
 * The opening <script> tags of raw HTML whose nonce attribute is missing or differs. The DOM
 * hides nonces (getAttribute returns ""), so this reads the response text.
 */
export function scriptsWithoutNonce(html: string, nonce: string): string[] {
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  return tags.filter((tag) => /\bnonce="([^"]*)"/.exec(tag)?.[1] !== nonce);
}
