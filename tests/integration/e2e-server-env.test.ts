// The e2e app server must set every variable the app reads. One it leaves out is filled from the
// developer's .env.local, which may point at the hosted project.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { E2E_LOGIN_EMAIL } from "../../e2e/helpers/local-supabase";
import { serverEnv } from "../../e2e/helpers/server-env";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const appVariables = readFileSync(join(ROOT, ".env.example"), "utf8")
  .split("\n")
  .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
  .map((line) => line.slice(0, line.indexOf("=")));

const local = {
  url: "http://127.0.0.1:54321",
  publishableKey: "publishable-test-value",
  secretKey: "secret-test-value",
};

describe("e2e server environment", () => {
  it("sets every variable in .env.example", () => {
    expect(appVariables.length).toBeGreaterThan(0);
    expect(Object.keys(serverEnv(local))).toEqual(expect.arrayContaining(appVariables));
  });

  it("points the app at the local stack and the e2e login user", () => {
    expect(serverEnv(local)).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: local.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
      SUPABASE_SECRET_KEY: local.secretKey,
      STATS_LOGIN_EMAIL: E2E_LOGIN_EMAIL,
      CRON_SECRET: "",
    });
  });
});
