// next.config.ts: Tailwind CSS v4 runs as a Turbopack loader on global stylesheets only. CSS
// modules must stay with Next's own handling, or their classes come out global (unhashed).
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

interface CssRule {
  condition?: { not?: { path?: RegExp } };
  loaders?: string[];
  as?: string;
}

const rule = (nextConfig.turbopack?.rules as Record<string, CssRule> | undefined)?.["*.css"];

describe("next.config.ts", () => {
  it("runs the Tailwind loader on global CSS", () => {
    expect(rule?.loaders).toEqual(["@tailwindcss/turbopack"]);
    expect(rule?.as).toBe("*.css");
    const excluded = rule?.condition?.not?.path;
    expect(excluded).toBeInstanceOf(RegExp);
    expect(excluded!.test("src/app/globals.css")).toBe(false);
    expect(excluded!.test("src/components/present/slide.css")).toBe(false);
  });

  it("leaves CSS modules to Next", () => {
    const excluded = rule!.condition!.not!.path!;
    expect(excluded.test("src/components/x/Card.module.css")).toBe(true);
    expect(excluded.test("src/app/module.css")).toBe(false);
  });

  it("keeps Cache Components off and the powered-by header out", () => {
    expect(nextConfig.cacheComponents).toBe(false);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
