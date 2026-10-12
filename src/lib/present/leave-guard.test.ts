import { describe, expect, it } from "vitest";
import { linkLeavesPage, type LinkClick } from "./leave-guard";

const here = { origin: "https://stats.example", pathname: "/rapporter/t-1", search: "" };
const click = (input: Partial<LinkClick> = {}): LinkClick => ({
  href: "/rapporter",
  target: null,
  download: false,
  button: 0,
  modified: false,
  defaultPrevented: false,
  ...input,
});

describe("linkLeavesPage", () => {
  it("is true for plain clicks on links to other pages of the app", () => {
    expect(linkLeavesPage(click(), here)).toBe(true);
    expect(linkLeavesPage(click({ href: "/presentera/t-1" }), here)).toBe(true);
    expect(linkLeavesPage(click({ href: "https://stats.example/utforska" }), here)).toBe(true);
    expect(linkLeavesPage(click({ href: "?bild=2", target: "_self" }), here)).toBe(true);
  });

  it("is false when the editor stays open", () => {
    expect(linkLeavesPage(click({ href: "#bild-2" }), here)).toBe(false);
    expect(linkLeavesPage(click({ href: "/rapporter/t-1" }), here)).toBe(false);
    expect(linkLeavesPage(click({ target: "_blank" }), here)).toBe(false);
    expect(linkLeavesPage(click({ modified: true }), here)).toBe(false);
    expect(linkLeavesPage(click({ button: 1 }), here)).toBe(false);
    expect(linkLeavesPage(click({ download: true }), here)).toBe(false);
    expect(linkLeavesPage(click({ defaultPrevented: true }), here)).toBe(false);
  });

  it("leaves other origins to the browser's own beforeunload prompt", () => {
    expect(linkLeavesPage(click({ href: "https://example.org/" }), here)).toBe(false);
    expect(linkLeavesPage(click({ href: "mailto:karim@example.org" }), here)).toBe(false);
  });
});
