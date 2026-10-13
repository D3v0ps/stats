// The single-password login: redirects, the one shared error message, logout and the throttle.
// Each test starts signed out and sends its own x-forwarded-for, so its failures never count
// against another test's throttle bucket.
import type { Page } from "@playwright/test";
import { LOGIN_ERROR } from "@/app/(auth)/login-security";
import { expect, test } from "./fixtures";
import { loginPassword, loginThroughUi, submitPassword } from "./helpers/auth";
import { clearLoginThrottle } from "./helpers/throttle";

test.use({ anonymous: true, ownThrottleBucket: true });

const loginError = (page: Page) => page.locator("#login-error");

/** Submits and waits for the server's answer: the error text alone repeats between attempts. */
async function attempt(page: Page, password: string) {
  const answered = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/logga-in",
  );
  await submitPassword(page, password);
  await answered;
}

test("an anonymous visitor is sent to the login page", async ({ page }) => {
  await page.goto("/utforska?matt=timmar");
  // The query string is dropped: login always lands on the overview.
  await expect(page).toHaveURL(/\/logga-in$/);
  await expect(page).toHaveTitle("Logga in · MB Stats");
  await expect(page.getByLabel("Lösenord")).toBeFocused();
});

test("a wrong password shows the shared error message", async ({ page }) => {
  await page.goto("/logga-in");
  await attempt(page, "fel-losenord-e2e");
  await expect(loginError(page)).toHaveText(LOGIN_ERROR);
  await expect(page).toHaveURL(/\/logga-in$/);
  await expect(page.getByLabel("Lösenord")).toHaveAttribute("aria-invalid", "true");
});

test("the right password lands on the overview, and logout signs out", async ({
  page,
  isMobile,
}) => {
  await loginThroughUi(page);

  if (isMobile) {
    await page.getByRole("button", { name: "Öppna menyn" }).click();
    await page
      .getByRole("dialog", { name: "Meny" })
      .getByRole("button", { name: "Logga ut" })
      .click();
  } else {
    await page.getByRole("button", { name: "Logga ut" }).click();
  }
  await expect(page).toHaveURL(/\/logga-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/logga-in$/);
});

test("five failures lock the address until the throttle is cleared @once", async ({ page }) => {
  await page.goto("/logga-in");
  for (let n = 1; n <= 5; n++) {
    await attempt(page, `fel-losenord-${n}`);
    await expect(loginError(page)).toHaveText(LOGIN_ERROR);
  }
  // Locked: the right password is refused with the same message.
  await attempt(page, loginPassword());
  await expect(loginError(page)).toHaveText(LOGIN_ERROR);
  await expect(page).toHaveURL(/\/logga-in$/);

  clearLoginThrottle();
  await submitPassword(page, loginPassword());
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1, name: "Översikt" })).toBeVisible();
});
