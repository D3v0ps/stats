// .env.example: the variable list a checkout copies to .env.local. Names only, no values,
// and comments that point at the hosted project and the RPCs the secret key is for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const text = readFileSync(join(ROOT, ".env.example"), "utf8");
const lines = text.split("\n").filter((l) => l.trim() !== "");
const variables = lines.filter((l) => !l.startsWith("#"));

describe(".env.example", () => {
  it("lists the variables without values", () => {
    expect(variables).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL=",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=",
      "SUPABASE_SECRET_KEY=",
      "STATS_LOGIN_EMAIL=",
      "CRON_SECRET=",
    ]);
  });

  it("names the hosted project and the throttle RPCs the secret key is used for", () => {
    expect(text).toContain('"Ekonomi mbimpact.se"');
    expect(text).toContain("mmiuuwrfcumcpgyleufu");
    expect(text).toContain("eu-north-1");
    expect(text).toContain("public.login_gate/login_record");
    expect(text).not.toContain("private.login_gate");
  });
});
