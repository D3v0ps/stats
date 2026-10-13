// The e2e harness's safety guards (e2e/helpers/local-supabase.ts): a run may only reach this
// machine, the E2E_SUPABASE_* override is all or nothing, and both JSON shapes the Supabase CLI
// prints for `db query` are read. Nothing here starts the CLI or touches a database.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QueryOutputSchema,
  assertLoopback,
  resolveLocalSupabase,
} from "../../e2e/helpers/local-supabase";

const NAMES = ["E2E_SUPABASE_URL", "E2E_SUPABASE_PUBLISHABLE_KEY", "E2E_SUPABASE_SECRET_KEY"];
const LOCAL = {
  E2E_SUPABASE_URL: "http://127.0.0.1:54321",
  E2E_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
  E2E_SUPABASE_SECRET_KEY: "secret-test-value",
};

function stubOverride(values: Partial<Record<string, string>>) {
  for (const name of NAMES) vi.stubEnv(name, values[name]);
  // Points the status fallback at a CLI that does not exist, so it can never run.
  vi.stubEnv("SUPABASE_CLI", "/nonexistent/supabase-cli-e2e-guards");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertLoopback", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:3100/logga-in",
    "http://LOCALHOST:3100",
    "http://[::1]:54321",
  ])("accepts %s", (url) => {
    expect(() => assertLoopback(url, "URL")).not.toThrow();
  });

  it.each([
    ["http://localhost@evil.example", "evil.example"],
    ["http://127.0.0.1.nip.io:54321", "127.0.0.1.nip.io"],
    ["https://abcdefgh.supabase.co", "abcdefgh.supabase.co"],
    ["http://0.0.0.0:3000", "0.0.0.0"],
    ["http://192.168.1.10:3000", "192.168.1.10"],
  ])("refuses %s", (url, host) => {
    expect(() => assertLoopback(url, "The Supabase URL")).toThrow(
      `The Supabase URL points at "${host}".`,
    );
  });

  it("names only the host, never userinfo or the path", () => {
    let message = "";
    try {
      assertLoopback("https://user:hunter2@db.example.com/path?key=abc", "URL");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"db.example.com"');
    expect(message).not.toMatch(/hunter2|user|path|abc/);
  });

  it("refuses a value that is not a URL", () => {
    expect(() => assertLoopback("", "E2E")).toThrow("E2E is not a valid URL.");
    expect(() => assertLoopback("not a url", "E2E")).toThrow("E2E is not a valid URL.");
    // Parsed as the scheme "localhost:" with an empty host.
    expect(() => assertLoopback("localhost:3100", "E2E")).toThrow('E2E points at "".');
  });
});

describe("resolveLocalSupabase with the E2E_SUPABASE_* override", () => {
  it("uses all three variables without calling the CLI", () => {
    stubOverride(LOCAL);
    expect(resolveLocalSupabase()).toEqual({
      url: LOCAL.E2E_SUPABASE_URL,
      publishableKey: LOCAL.E2E_SUPABASE_PUBLISHABLE_KEY,
      secretKey: LOCAL.E2E_SUPABASE_SECRET_KEY,
    });
  });

  it.each([1, 2])("refuses %i of the three variables", (count) => {
    const partial = Object.fromEntries(Object.entries(LOCAL).slice(0, count));
    stubOverride(partial);
    expect(() => resolveLocalSupabase()).toThrow(
      `Set all of ${NAMES.join(", ")}, or none of them.`,
    );
  });

  it("treats empty values as unset", () => {
    stubOverride({ ...LOCAL, E2E_SUPABASE_SECRET_KEY: "" });
    expect(() => resolveLocalSupabase()).toThrow("or none of them.");
  });

  it("refuses a hosted Supabase URL without printing the keys", () => {
    stubOverride({ ...LOCAL, E2E_SUPABASE_URL: "https://abcdefgh.supabase.co" });
    let message = "";
    try {
      resolveLocalSupabase();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('points at "abcdefgh.supabase.co"');
    expect(message).not.toContain("test-value");
  });

  it("names the invalid fields, not their values", () => {
    stubOverride({ ...LOCAL, E2E_SUPABASE_URL: "ftp://127.0.0.1:54321" });
    expect(() => resolveLocalSupabase()).toThrow(
      "Invalid local Supabase values from E2E_SUPABASE_*: url.",
    );
  });

  it("falls back to `supabase status` when none is set", () => {
    stubOverride({});
    expect(() => resolveLocalSupabase()).toThrow(
      "Supabase CLI not found: install it or set SUPABASE_CLI to its path.",
    );
  });
});

describe("QueryOutputSchema", () => {
  const rows = [{ n: 2 }, { n: 0 }];

  it("reads the bare array the CLI prints for a person", () => {
    expect(QueryOutputSchema.parse(JSON.parse(JSON.stringify(rows)))).toEqual(rows);
  });

  it("reads the { rows } object the CLI prints when it thinks an agent runs it", () => {
    expect(QueryOutputSchema.parse({ rows, boundary: "x" })).toEqual(rows);
  });

  it("refuses anything else", () => {
    expect(() => QueryOutputSchema.parse({ data: rows })).toThrow();
    expect(() => QueryOutputSchema.parse("2")).toThrow();
  });
});
