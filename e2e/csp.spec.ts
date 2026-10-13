// The nonce in the raw HTML: every <script> a page is served with carries the nonce of that
// response's Content-Security-Policy, and the scripts really ran (Next's bootstrap sets
// window.next). Violations themselves fail every test through fixtures.ts.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { policyNonce, scriptsWithoutNonce } from "./helpers/csp";
import { REPORT_MONTH } from "./helpers/reports";

async function expectNoncedScripts(page: Page, path: string, status = 200): Promise<string> {
  const response = await page.goto(path);
  if (!response) throw new Error(`No response for ${path}`);
  expect(response.status()).toBe(status);
  const nonce = policyNonce(response.headers()["content-security-policy"]);
  expect(nonce, `${path}: the policy has a nonce`).not.toBeNull();
  const html = await response.text();
  expect(html, `${path}: serves scripts`).toMatch(/<script\b/);
  expect(scriptsWithoutNonce(html, nonce ?? ""), `${path}: scripts without the nonce`).toEqual([]);
  await page.waitForFunction(() => "next" in window);
  return nonce ?? "";
}

test("signed-in pages stamp the response's nonce on every script", async ({
  page,
  frozenReport,
}) => {
  const first = await expectNoncedScripts(page, `/?manad=${REPORT_MONTH}`);
  // The upload page starts the ingest worker, Säkerhet calls Supabase from the browser.
  await expectNoncedScripts(page, "/ladda-upp");
  await expectNoncedScripts(page, "/installningar/sakerhet");
  await expectNoncedScripts(page, `/presentera/arkiv/${await frozenReport()}/utskrift`);
  // Not prerendered: a static 404 would carry no nonce and never hydrate.
  await expectNoncedScripts(page, "/finns-inte", 404);
  expect(await expectNoncedScripts(page, `/?manad=${REPORT_MONTH}`)).not.toBe(first);
});

test.describe("signed out", () => {
  test.use({ anonymous: true });

  test("the login page stamps the nonce on every script", async ({ page }) => {
    await expectNoncedScripts(page, "/logga-in");
  });
});
