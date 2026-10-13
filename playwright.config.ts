import { defineConfig, devices } from "@playwright/test";
import {
  E2E_LOGIN_EMAIL,
  assertLoopback,
  resolveLocalSupabase,
} from "./e2e/helpers/local-supabase";

// Pinned to @playwright/test 1.56.1 so it uses the Chromium build preinstalled in
// the cloud environment (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers).
//
// Local only: the suite resets a database, creates a user and records failed logins, so both
// the app and its Supabase must be on this machine. See README "Tester från början till slut".
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
assertLoopback(BASE_URL, "E2E_BASE_URL");
const supabase = resolveLocalSupabase();

const SEED = /e2e[\\/]seed[\\/].+\.spec\.ts$/;
const LAST = /e2e[\\/]sist[\\/].+\.spec\.ts$/;
const laptop = { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } };

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One database and one shared login user: tests must not run concurrently.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    // Numbers count up from 0 otherwise.
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [
    // Publishes the fixtures through the real upload UI; the other projects read that data.
    {
      name: "seed",
      testMatch: SEED,
      timeout: 300_000,
      use: laptop,
    },
    {
      name: "projektor",
      testIgnore: [SEED, LAST],
      dependencies: ["seed"],
      grepInvert: /@once/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "laptop",
      testIgnore: [SEED, LAST],
      dependencies: ["seed"],
      use: laptop,
    },
    {
      name: "mobil",
      testIgnore: [SEED, LAST],
      dependencies: ["seed"],
      grepInvert: /@once/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    // Logout everywhere and the password round trip end every session of the shared user.
    {
      name: "sist",
      testMatch: LAST,
      dependencies: ["projektor", "laptop", "mobil"],
      use: laptop,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // NEXT_PUBLIC_* are inlined at build time, so .next is always rebuilt with the local
        // values. Every variable the app reads is set here, so a .env.local (which may hold the
        // hosted project) can fill none of them; an empty CRON_SECRET counts as set.
        command: `pnpm build && pnpm start -p ${PORT}`,
        url: `${BASE_URL}/logga-in`,
        reuseExistingServer: false,
        timeout: 400_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: supabase.url,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
          SUPABASE_SECRET_KEY: supabase.secretKey,
          STATS_LOGIN_EMAIL: E2E_LOGIN_EMAIL,
          CRON_SECRET: "",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});
