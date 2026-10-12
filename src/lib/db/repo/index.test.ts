import { describe, expect, it } from "vitest";
import * as explore from "./explore-extra";
import * as importExtra from "./import-extra";
import * as repo from "./index";
import * as present from "./present-extra";
import * as settings from "./settings-extra";

describe("repo index", () => {
  it.each([
    ["explore-extra", explore],
    ["import-extra", importExtra],
    ["present-extra", present],
    ["settings-extra", settings],
  ] as const)("re-exports every function of %s unchanged", (_name, mod) => {
    const fns = Object.entries(mod).filter(([, v]) => typeof v === "function");
    expect(fns.length).toBeGreaterThan(0);
    for (const [key, fn] of fns) expect((repo as Record<string, unknown>)[key], key).toBe(fn);
  });
});
