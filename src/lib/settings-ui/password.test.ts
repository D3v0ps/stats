import { describe, expect, it } from "vitest";
import { newPasswordError, newPasswordIssue, passwordChangeError } from "./password";

describe("newPasswordError", () => {
  const good = "korrekt häst batteri";

  it("accepts a long matching password", () => {
    expect(newPasswordError(good, good)).toBeNull();
  });

  it("requires 16 characters, matching fields and no edge spaces", () => {
    expect(newPasswordError("kort", "kort")).toMatch(/minst 16/);
    expect(newPasswordError(good, `${good}x`)).toBe("Lösenorden är inte lika.");
    expect(newPasswordError(` ${good}`, ` ${good}`)).toMatch(/mellanslag/);
  });

  it("names the field each problem belongs to", () => {
    expect(newPasswordIssue("kort", "kort")?.field).toBe("new");
    expect(newPasswordIssue(good, "annat")?.field).toBe("repeat");
    expect(newPasswordIssue(good, good)).toBeNull();
  });

  it("limits the length in bytes (bcrypt uses 72)", () => {
    expect(newPasswordError("a".repeat(72), "a".repeat(72))).toBeNull();
    expect(newPasswordError("a".repeat(73), "a".repeat(73))).toMatch(/högst 72/);
    expect(newPasswordError("å".repeat(37), "å".repeat(37))).toMatch(/högst 72/);
  });
});

describe("passwordChangeError", () => {
  it("maps Auth error codes to Swedish", () => {
    expect(passwordChangeError({ code: "same_password" })).toMatch(/skilja sig/);
    expect(passwordChangeError({ code: "weak_password" })).toMatch(/för svagt/);
    expect(passwordChangeError({ code: "reauthentication_needed" })).toMatch(/Logga in igen/);
    expect(passwordChangeError({ status: 401 })).toMatch(/Logga in igen/);
    expect(passwordChangeError({ name: "EnvError" })).toMatch(/inte konfigurerad/);
    expect(passwordChangeError(new Error("network"))).toBe(
      "Lösenordet kunde inte bytas. Försök igen.",
    );
    expect(passwordChangeError(null)).toBe("Lösenordet kunde inte bytas. Försök igen.");
  });
});
