import { describe, expect, it } from "vitest";
import { GENERIC_ERROR, errorMessage, fail, isNavigationError, ok } from "./action-result";
import { SETTINGS_SECTIONS, activeSection, sectionBySlug } from "./sections";

describe("action results", () => {
  it("builds success and failure results", () => {
    expect(ok("Sparat")).toEqual({ ok: true, message: "Sparat", data: undefined });
    expect(ok("Sparat", { n: 2 })).toEqual({ ok: true, message: "Sparat", data: { n: 2 } });
    expect(fail("Nej")).toEqual({ ok: false, error: "Nej" });
  });

  it("maps database error codes to Swedish without echoing values", () => {
    expect(errorMessage({ code: "23505", message: "duplicate key value (key)=(x)" })).toMatch(
      /finns redan/,
    );
    expect(errorMessage({ code: "23503", message: "violates foreign key" })).toMatch(/används/);
    expect(
      errorMessage({
        code: "23514",
        message: "Personnummer får inte sparas (dimension_values.label)",
      }),
    ).toBe("Personnummer får inte sparas.");
    expect(errorMessage({ code: "23514", message: "check constraint" })).toBe(
      "Värdet är inte tillåtet.",
    );
    expect(errorMessage({ code: "42501", message: "permission denied" })).toBe(
      "Behörighet saknas.",
    );
  });

  it("passes Swedish repo messages through and hides English ones", () => {
    expect(errorMessage(new Error("Måttet finns inte: x"))).toBe("Måttet finns inte: x");
    expect(errorMessage(new Error("Okänd dimension: x"))).toBe("Okänd dimension: x");
    expect(errorMessage(new Error("fetch failed"))).toBe(GENERIC_ERROR);
    expect(errorMessage("boom")).toBe(GENERIC_ERROR);
    expect(errorMessage({ name: "ZodError", message: "[...]" })).toBe("Ogiltiga uppgifter.");
  });
});

describe("isNavigationError", () => {
  it("recognizes redirect and not-found rejections from server actions", () => {
    expect(isNavigationError({ digest: "NEXT_REDIRECT;push;/logga-in;307;" })).toBe(true);
    expect(isNavigationError({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })).toBe(true);
    expect(isNavigationError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNavigationError({ digest: "1234567" })).toBe(false);
    expect(isNavigationError(null)).toBe(false);
  });
});

describe("settings sections", () => {
  it("has a unique slug and href per section", () => {
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      "Mått",
      "Dimensioner och uppslag",
      "Kontogrupper",
      "Importmallar",
      "Bolag och räkenskapsår",
      "Perioder",
      "Granskning",
      "Säkerhet",
    ]);
  });

  it("finds the active section including sub-pages", () => {
    expect(activeSection("/installningar")).toBeNull();
    expect(activeSection("/installningar/matt")?.slug).toBe("matt");
    expect(activeSection("/installningar/dimensioner/kund")?.slug).toBe("dimensioner");
    expect(activeSection("/installningar/mattx")).toBeNull();
    expect(sectionBySlug("bolag").href).toBe("/installningar/bolag");
    expect(() => sectionBySlug("nope")).toThrow();
  });
});
