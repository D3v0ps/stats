import { isValidElement, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = "NEXT_NOT_FOUND";
const labels = vi.fn(async (_dimension: string, ids: number[]) =>
  Object.fromEntries(ids.filter((id) => id === 7).map((id) => [id, "IKEA"])),
);
const loadWorkspace = vi.fn(async () => ({
  source: { labels },
  dimensions: [{ key: "kund", label: "Kund", personal: false }],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));
vi.mock("@/lib/db/session", () => ({ requireSession: async () => ({ userId: "u" }) }));
vi.mock("@/components/explore/workspace", () => ({ loadWorkspace }));
vi.mock("@/components/explore/EntityPanel", () => ({ EntityPanel: () => null }));
vi.mock("@/components/filters/GlobalFilterBar", () => ({
  GlobalFilterBar: () => null,
  FilterBarSkeleton: () => null,
}));

const { default: EntityPage } = await import("./page");

const open = (dimension: string, value: string) =>
  EntityPage({
    params: Promise.resolve({ dimension, value }),
    searchParams: Promise.resolve({}),
  });

describe("/utforska/[dimension]/[value]", () => {
  beforeEach(() => {
    labels.mockClear();
    loadWorkspace.mockClear();
  });

  it("answers an unknown value or dimension with notFound() before streaming", async () => {
    await expect(open("kund", "8")).rejects.toThrow(NOT_FOUND);
    await expect(open("ort", "7")).rejects.toThrow(NOT_FOUND);
    await expect(open("kund", "abc")).rejects.toThrow(NOT_FOUND);
    // A malformed id never reaches the database.
    expect(labels).toHaveBeenCalledTimes(1);
  });

  it("streams the entity in a Suspense boundary once it is known to exist", async () => {
    const page = await open("kund", "7");
    expect(isValidElement(page) && page.type === Suspense).toBe(true);
    expect(labels).toHaveBeenCalledWith("kund", [7]);
  });

  it("leaves a database failure to the page's error state, not a 404", async () => {
    loadWorkspace.mockRejectedValueOnce(new Error("offline"));
    const page = await open("kund", "8");
    expect(isValidElement(page) && page.type === Suspense).toBe(true);
  });
});
