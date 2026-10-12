import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavItemActive } from "./nav-items";

describe("NAV_ITEMS", () => {
  it("lists the main routes in order with Swedish labels", () => {
    expect(NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ["Översikt", "/"],
      ["Utforska", "/utforska"],
      ["Ladda upp", "/ladda-upp"],
      ["Rapporter", "/rapporter"],
      ["Inställningar", "/installningar"],
    ]);
  });
});

describe("isNavItemActive", () => {
  it("activates Översikt only on the start page", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/utforska", "/")).toBe(false);
  });

  it("activates a section on its own page and sub-pages", () => {
    expect(isNavItemActive("/rapporter", "/rapporter")).toBe(true);
    expect(isNavItemActive("/rapporter/2026-09", "/rapporter")).toBe(true);
  });

  it("does not match sibling routes that share a prefix", () => {
    expect(isNavItemActive("/rapporter-gamla", "/rapporter")).toBe(false);
    expect(isNavItemActive("/ladda", "/ladda-upp")).toBe(false);
  });
});
