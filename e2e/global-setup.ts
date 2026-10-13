// Runs once in the Playwright runner, after the webServer has started (Playwright 1.56 sets up
// plugins such as webServer before globalSetup). Resets the LOCAL database and creates the one
// login user with a fresh random password. Workers are forked afterwards and inherit
// process.env, so the password reaches them without being written to disk or logged.
import { randomBytes } from "node:crypto";
import { allowlistUser, createE2eAdminClient, ensureLoginUser } from "./helpers/admin";
import {
  E2E_LOGIN_EMAIL,
  clearLoginThrottle,
  resetLocalDatabase,
  resolveLocalSupabase,
  waitForLocalSupabase,
} from "./helpers/local-supabase";

export default async function globalSetup(): Promise<void> {
  const env = resolveLocalSupabase();
  if (process.env.E2E_SKIP_DB_RESET !== "1") resetLocalDatabase();
  await waitForLocalSupabase(env);
  // Matters when the reset is skipped: earlier runs' failures would count against the bucket
  // the worker logins share (they send no x-forwarded-for).
  clearLoginThrottle();

  const admin = createE2eAdminClient(env);
  // 32 characters: above the app's own 16-character rule for a new password.
  const password = randomBytes(24).toString("base64url");
  const userId = await ensureLoginUser(admin, E2E_LOGIN_EMAIL, password);
  await allowlistUser(admin, userId);

  process.env.E2E_LOGIN_PASSWORD = password;
  process.env.E2E_USER_ID = userId;
}
