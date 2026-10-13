// src/app/globals.css is the theme contract for every module: check it against the brand spec
// and against tokens.ts, so the two can never drift apart.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { cssColorOffenders } from "./palette-audit";
import { BRAND_COLORS, PALETTE } from "./tokens";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GLOBALS = path.join(ROOT, "src/app/globals.css");
const css = readFileSync(GLOBALS, "utf8");
const tailwindCss = readFileSync(path.join(ROOT, "node_modules/tailwindcss/index.css"), "utf8");

/** Custom properties declared directly inside the first block whose selector is `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`${selector} not found`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    vars[match[1]!] = match[2]!.trim().toLowerCase();
  }
  return vars;
}

/** An `@import` as Tailwind resolves it: a relative path, or a package's `style` export. */
function resolveStylesheet(id: string, base: string): string {
  if (id.startsWith(".")) return path.resolve(base, id);
  const name = id.split("/", id.startsWith("@") ? 2 : 1).join("/");
  const dir = path.join(ROOT, "node_modules", name);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    exports?: Record<string, string | { style?: string }>;
  };
  const entry = pkg.exports?.[`.${id.slice(name.length)}`];
  const file = typeof entry === "string" ? entry : entry?.style;
  if (!file) throw new Error(`No stylesheet export for ${id}`);
  return path.join(dir, file);
}

describe("globals.css theme", () => {
  const root = block(":root");

  it("maps the MB tokens onto the shadcn variables", () => {
    expect(root).toMatchObject({
      "--background": "#f1f2f3",
      "--card": "#ffffff",
      "--foreground": "#1e252b",
      "--primary": "#1e252b",
      "--primary-foreground": "#ffffff",
      // Focused menu items and options use accent: light grey with antracit text, not red.
      "--accent": "#e4e5e6",
      "--accent-foreground": "#1e252b",
      "--destructive": "#ff0c01",
      "--muted": "#e4e5e6",
      "--muted-foreground": "#494e52",
      "--border": "#e4e5e6",
      "--ring": "#6ba2b9",
      "--chart-1": "#1e252b",
      "--chart-2": "#6ba2b9",
      "--chart-3": "#d1d3d3",
      "--chart-4": "#8d9093",
      "--chart-5": "#aecbd7",
      "--sidebar": "#1e252b",
      "--sidebar-foreground": "#ffffff",
    });
  });

  it("exposes every brand colour as a Tailwind colour with the tokens.ts values", () => {
    const theme = block("@theme");
    for (const family of ["antracit", "rod", "ljusgra", "bla"] as const) {
      const tones = PALETTE[family];
      expect(theme[`--color-${family}`]).toBe(tones.base.toLowerCase());
      for (const tone of [300, 200, 100] as const) {
        expect(theme[`--color-${family}-${tone}`]).toBe(tones[tone].toLowerCase());
      }
    }
    // Tailwind's default palette (greens included) is switched off.
    expect(css).toMatch(/@theme\s*\{\s*--color-\*:\s*initial;/);
  });

  it("uses no colour outside the brand palette (and nothing green)", () => {
    const allowed = new Set(BRAND_COLORS.map((c) => c.toLowerCase()));
    const hexes = [...css.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
    expect(hexes.length).toBeGreaterThan(20);
    expect(hexes.filter((hex) => !allowed.has(hex))).toEqual([]);
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/green|emerald|lime/i);
  });

  it("casts all of Tailwind's shadows in antracit, keeping Tailwind's geometry", () => {
    // Tailwind declares its deprecated unsized keys in an `inline reference` block. Ours must
    // be in the same kind of block, or the bare utilities compile differently.
    const deprecatedAt = tailwindCss.indexOf("@theme default inline reference {");
    expect(deprecatedAt).toBeGreaterThan(0);
    const theme = block("@theme");
    const deprecated = block("@theme inline reference");
    const flat = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const black = [...tailwindCss.matchAll(/(--[\w-]*shadow[\w-]*):\s*([^;]+);/g)].filter(
      ([, , value]) => value!.includes("rgb(0 0 0"),
    );
    // Box, inset, drop and text shadows plus the deprecated unsized keys.
    expect(black.length).toBeGreaterThanOrEqual(24);
    for (const { 1: name, 2: value, index } of black) {
      const ours = index > deprecatedAt ? deprecated : theme;
      const antracit = value!.replaceAll("rgb(0 0 0 /", "rgb(30 37 43 /");
      expect(flat(ours[name!] ?? "missing"), name).toBe(flat(antracit));
    }
  });

  it("compiles the classes the build finds to palette colours only", async () => {
    const compiler = await compile(css, {
      base: path.dirname(GLOBALS),
      loadStylesheet: async (id, base) => {
        const file = resolveStylesheet(id, base);
        return { path: file, base: path.dirname(file), content: readFileSync(file, "utf8") };
      },
    });
    // The scan @tailwindcss/turbopack runs: the whole project (the build's working directory,
    // minus what .gitignore lists) plus any `@source`.
    const scanner = new Scanner({
      sources: [{ base: ROOT, pattern: "**/*", negated: false }, ...compiler.sources],
    });
    const output = compiler.build(scanner.scan());
    // shadcn's overlay shadows are in there, so the check has something to bite on.
    expect(output).toContain(".shadow-md");
    expect(cssColorOffenders(output)).toEqual([]);

    // The bare utility named after the deprecated key, cut out of it at runtime so the scan
    // does not find it in this file.
    const dropShadow = "--drop-shadow".slice(2);
    const filter = compiler.build([dropShadow]);
    expect(filter).not.toContain(`${dropShadow}(var(`);
    expect(filter).toContain(`${dropShadow}(0 1px 2px rgb(30 37 43 / 0.1)) ${dropShadow}(`);
  });

  it("has the 18px card radius, --shadow-soft and no dark theme", () => {
    const theme = block("@theme");
    expect(theme["--radius-card"]).toBe("18px");
    expect(theme["--shadow-soft"]).toBeTruthy();
    expect(css).not.toMatch(/^\.dark\s*\{/m);
  });

  it("has an antracit presentation scope with white text", () => {
    const present = block(".theme-present");
    expect(present["--background"]).toBe("#1e252b");
    expect(present["--foreground"]).toBe("#ffffff");
    expect(css).toMatch(/\.theme-present\s*\{[^}]*background-color:\s*var\(--background\)/);
  });

  it("offers `num` for tabular figures and switches motion off when asked", () => {
    expect(css).toMatch(/@utility num\s*\{\s*font-variant-numeric:\s*tabular-nums;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration/);
    expect(css).toMatch(/\[data-static\][^{]*\{[^}]*animation:\s*none/);
  });
});
