// Project "sist" runs after every other project: both tests end sessions or change the one
// shared password, which would break any spec running after them.
import { randomBytes } from "node:crypto";
import { LOGIN_ERROR } from "@/app/(auth)/login-security";
import { expect, test } from "../fixtures";
import { createE2eAdminClient, setLoginPassword } from "../helpers/admin";
import { ANONYMOUS, loginPassword, loginThroughUi, submitPassword } from "../helpers/auth";
import { queryLocalSql, resolveLocalSupabase } from "../helpers/local-supabase";
import { documentationIp } from "../helpers/throttle";

test.describe.configure({ mode: "serial" });

function userId(): string {
  const id = process.env.E2E_USER_ID;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("E2E_USER_ID is missing or invalid.");
  return id;
}

function sessionCount(): number {
  const [row] = queryLocalSql(
    `select count(*)::int as n from auth.sessions where user_id = '${userId()}'`,
  );
  return Number(row?.n);
}

test("the password can be changed, and only the new one works", async ({ page, browser }) => {
  const original = loginPassword();
  const changed = randomBytes(24).toString("base64url");

  await page.goto("/installningar/sakerhet");
  await page.getByTestId("password-new").fill(changed);
  await page.getByTestId("password-repeat").fill(changed);
  await page.getByTestId("password-save").click();
  try {
    await expect(page.getByText(/^Lösenordet är bytt\./)).toBeVisible();

    // A signed-out browser (newContext inherits the test's session otherwise) with its own
    // throttle bucket, so the failed old password locks nothing.
    const other = await browser.newContext({
      storageState: ANONYMOUS,
      extraHTTPHeaders: { "x-forwarded-for": documentationIp() },
    });
    const login = await other.newPage();
    await login.goto("/logga-in");
    await submitPassword(login, original);
    await expect(login.locator("#login-error")).toHaveText(LOGIN_ERROR);
    await loginThroughUi(login, changed);
    await other.close();
  } finally {
    await setLoginPassword(createE2eAdminClient(resolveLocalSupabase()), userId(), original);
  }
});

test.describe("logga ut alla enheter", () => {
  test.use({ anonymous: true, ownThrottleBucket: true });

  test("ends every session of the shared user", async ({ page, browser }) => {
    // newContext inherits the test's options: signed out, same throttle bucket.
    const other = await browser.newContext();
    await loginThroughUi(await other.newPage());
    await loginThroughUi(page);
    expect(sessionCount()).toBeGreaterThanOrEqual(2);

    await page.goto("/installningar/sakerhet");
    await page.getByTestId("logout-everywhere").click();
    await page.getByTestId("logout-everywhere-dialog-confirm").click();
    await expect(page).toHaveURL(/\/logga-in$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/logga-in$/);

    // The other browser keeps its access token until it expires (up to an hour locally, the
    // page says so), but its session and refresh token are gone.
    expect(sessionCount()).toBe(0);
    await other.close();
  });
});
