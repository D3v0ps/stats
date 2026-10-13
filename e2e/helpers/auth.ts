import { expect, type BrowserContext, type Page } from "@playwright/test";

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export const ANONYMOUS: StorageState = { cookies: [], origins: [] };

/** The per-run password global setup gave the e2e user. */
export function loginPassword(): string {
  const password = process.env.E2E_LOGIN_PASSWORD;
  if (!password) throw new Error("E2E_LOGIN_PASSWORD is missing: global setup did not run.");
  return password;
}

export async function submitPassword(page: Page, password: string) {
  await page.getByLabel("Lösenord").fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
}

export async function loginThroughUi(page: Page, password = loginPassword()) {
  await page.goto("/logga-in");
  await submitPassword(page, password);
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1, name: "Översikt" })).toBeVisible();
}
