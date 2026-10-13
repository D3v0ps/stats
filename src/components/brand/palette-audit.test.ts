import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  colorOffenders,
  cssColorOffenders,
  namedColorOffenders,
  tailwindPaletteClasses,
} from "./palette-audit";

// Tailwind classes are assembled at runtime: written out whole, Tailwind would scan them from
// this file into the app's CSS.
const arbitrary = (prefix: string, value: string) => `${prefix}[${value}]`;

describe("colorOffenders", () => {
  it("flags black shadows in any notation", () => {
    expect(colorOffenders("box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1)")).toEqual([
      "rgba(0, 0, 0, 0.1)",
    ]);
    expect(colorOffenders("--tw-shadow: 0 1px 3px 0 var(--tw-shadow-color, #0000001a)")).toEqual([
      "#0000001a",
    ]);
    expect(colorOffenders("0 1px rgb(0 0 0 / 0.05)")).toEqual(["rgb(0 0 0 / 0.05)"]);
    expect(colorOffenders(arbitrary("shadow-", "0_1px_2px_rgb(0_0_0/0.1)"))).toHaveLength(1);
  });

  it("flags a mix of two colours but accepts alpha mixes with transparent", () => {
    const hover = `hover:${arbitrary("bg-", "color-mix(in_oklch,var(--secondary),var(--foreground)_5%)")}`;
    expect(colorOffenders(hover)).toHaveLength(1);
    expect(colorOffenders("color-mix(in oklab, var(--color-black) 10%, transparent)")).toEqual([]);
    expect(colorOffenders("color-mix(in oklab, currentcolor 50%, transparent)")).toEqual([]);
    expect(colorOffenders("color-mix(in srgb, #3f3f3f 40%, transparent)")).toEqual(["#3f3f3f"]);
  });

  it("flags stray greys, green and notations the palette is not written in", () => {
    expect(colorOffenders("color: #3f3f3f; border: 1px solid #ccc")).toEqual(["#3f3f3f", "#ccc"]);
    expect(colorOffenders("--success-text: hsl(140, 100%, 27%)")).toEqual(["hsl(140, 100%, 27%)"]);
    expect(colorOffenders("fill: #22c55e")).toEqual(["#22c55e"]);
    expect(colorOffenders("oklch(0.72 0.19 150) lab(50 0 0) color(srgb 1 0 0)")).toHaveLength(3);
  });

  it("accepts palette colours in any case and at any alpha, and transparent black", () => {
    expect(
      colorOffenders(
        "#1E252B #1e252b1a #FFF #ffffffb3 #0000 rgb(30 37 43 / 0.04) rgba(255, 12, 1, 0.5) " +
          `${arbitrary("shadow-", "0_1px_2px_rgb(30_37_43/0.1)")} hsl(0 0% 100%)`,
      ),
    ).toEqual([]);
  });

  it("ignores attribute selectors, entities and things that only look like colours", () => {
    expect(colorOffenders("[&_.recharts-dot[stroke='#fff']]:stroke-transparent")).toEqual([]);
    expect(colorOffenders(".recharts-grid line[stroke='#ccc'] { stroke: var(--border) }")).toEqual(
      [],
    );
    expect(colorOffenders("&#123; roleColor(x) seriesColor(y) issue #12345")).toEqual([]);
  });
});

describe("namedColorOffenders", () => {
  it("flags named colours assigned to colour properties", () => {
    expect(namedColorOffenders('<text fill="black">')).toEqual(['fill="black']);
    expect(namedColorOffenders("style={{ backgroundColor: 'tomato' }}")).toHaveLength(1);
    expect(namedColorOffenders("a { color: red; }")).toHaveLength(1);
    expect(namedColorOffenders(arbitrary("text-", "gray"))).toHaveLength(1);
  });

  it("allows white, currentColor, none and variables, and ignores prose", () => {
    expect(
      namedColorOffenders(
        'stroke="white" fill="currentColor" fill="none" stroke: "var(--card)" color: string',
      ),
    ).toEqual([]);
    expect(namedColorOffenders("// red only highlights; no green anywhere")).toEqual([]);
  });
});

describe("cssColorOffenders", () => {
  it("checks declarations, including custom properties and nested rules", () => {
    expect(
      cssColorOffenders(
        ".a{--tw-shadow:0 4px 6px -1px #0000001a}.b{&:hover{background:black}}.c{color:#1e252b}",
      ),
    ).toEqual(["--tw-shadow: #0000001a", "background: black"]);
  });

  it("skips selectors, @supports preludes, comments, strings and font names", () => {
    expect(
      cssColorOffenders(
        "@supports (color: color-mix(in lab, red, red)) { .x[fill='red'] { color: var(--a) } }" +
          "/* color: red */ .y{content:'red';font-family:Apple Color Emoji, sans-serif}",
      ),
    ).toEqual([]);
  });
});

describe("tailwindPaletteClasses", () => {
  it("flags Tailwind's default palette and leaves the brand colours alone", () => {
    const families = ["gray", "emerald", "blue"];
    // These compile to nothing here (the default palette is reset), so they can stay literal.
    const used = "hover:text-gray-500 bg-emerald-50 ring-blue-300/50";
    expect(tailwindPaletteClasses(used, families)).toHaveLength(3);
    const brand = ["antracit-300", "rod", "bla-100", "ljusgra-200"].map((tone) => `bg-${tone}`);
    expect(tailwindPaletteClasses(brand.join(" "), families)).toEqual([]);
  });
});

describe("src/**", () => {
  const src = fileURLToPath(new URL("../..", import.meta.url));
  const tailwindCss = readFileSync(
    fileURLToPath(new URL("../../../node_modules/tailwindcss/index.css", import.meta.url)),
    "utf8",
  );
  const families = [
    ...new Set([...tailwindCss.matchAll(/--color-([a-z]+)-950:/g)].map((m) => m[1]!)),
  ];

  it("uses brand colours only: no black shadows, colour mixes, stray greys or green", () => {
    expect(families).toContain("emerald");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => {
      const text = readFileSync(path.join(src, file), "utf8");
      const found = file.endsWith(".css")
        ? cssColorOffenders(text)
        : [...colorOffenders(text), ...namedColorOffenders(text)];
      found.push(...tailwindPaletteClasses(text, families));
      // Sonner's rich colours paint success toasts green.
      if (/\brichColors\b/.test(text)) found.push("richColors");
      return found.map((offender) => `${file}: ${offender}`);
    });
    expect(offenders).toEqual([]);
  });
});
