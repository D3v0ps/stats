// supabase/config.toml: the CLI config a checkout uses to `supabase link` the hosted project.
// Checked line by line (no TOML parser is installed): the project id, the auth settings of the
// hosted project as comments only, and nothing that looks like a secret.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const text = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
const lines = text.split("\n");
const active = lines.filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
const comments = lines
  .filter((l) => l.trim().startsWith("#"))
  .map((l) => l.replace(/^\s*#\s?/, ""));

/** Keys set (not commented) inside a [section] of the file. */
function sectionKeys(section: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const line of active) {
    const header = /^\[([^\]]+)\]$/.exec(line.trim());
    if (header) current = header[1]!;
    else if (current === section) out.push(line.split("=")[0]!.trim());
  }
  return out;
}

describe("supabase/config.toml", () => {
  it("names the project mb-stats and says how to link the hosted project", () => {
    expect(active[0]).toBe('project_id = "mb-stats"');
    expect(text).toContain("supabase link --project-ref mmiuuwrfcumcpgyleufu");
  });

  it("documents the hosted auth settings as comments, never as values", () => {
    for (const setting of [
      "enable_signup = false",
      "jwt_expiry = 900",
      "minimum_password_length = 16",
    ]) {
      expect(comments, setting).toContain(setting);
    }
    const managed = ["enable_signup", "jwt_expiry", "minimum_password_length"];
    expect(sectionKeys("auth").filter((k) => managed.includes(k))).toEqual([]);
    expect(sectionKeys("auth.email")).toEqual([]);
    // Commented auth settings mean CLI defaults on a push: the file must warn about it.
    expect(text).toMatch(/Do NOT run `supabase config push`/);
  });

  it("holds no secrets", () => {
    expect(text).not.toMatch(/sb_secret_|sb_publishable_|service_role|eyJ[A-Za-z0-9_-]{10,}/);
    expect(active.some((l) => /(secret|password|_key|token)\s*=/i.test(l))).toBe(false);
  });
});
