import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANTRACIT,
  BLA,
  BRAND_COLORS,
  CATEGORICAL,
  CHART_ROLES,
  LJUSGRA,
  PALETTE,
  ROD,
  WHITE,
  assignSeriesColors,
  categoricalColor,
  labelColorOn,
  roleColor,
  seriesColor,
} from "./tokens";

describe("palette", () => {
  it("contains exactly the brand colours from CLAUDE.md", () => {
    expect([...BRAND_COLORS].sort()).toEqual(
      [
        "#FFFFFF",
        "#1E252B",
        "#494E52",
        "#8D9093",
        "#C6C8C9",
        "#FF0C01",
        "#FE5D4A",
        "#FF998E",
        "#FFCCC6",
        "#D1D3D3",
        "#D3D6D7",
        "#E4E5E6",
        "#F1F2F3",
        "#6BA2B9",
        "#7EACC0",
        "#AECBD7",
        "#D7E5EB",
      ].sort(),
    );
  });

  it("never uses a colour outside the palette in the chart sequences", () => {
    for (const swatch of [...CATEGORICAL, ...Object.values(CHART_ROLES)]) {
      expect(BRAND_COLORS).toContain(swatch.hex);
    }
  });

  it("keeps red out of the categorical sequence (red only highlights)", () => {
    for (const swatch of CATEGORICAL) {
      expect([ROD, PALETTE.rod[300], PALETTE.rod[200], PALETTE.rod[100]]).not.toContain(swatch.hex);
    }
  });

  it("matches the colours declared in globals.css", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const declared = (name: string) =>
      new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, "i").exec(css)?.[1]?.toUpperCase();
    expect(declared("antracit")).toBe(ANTRACIT);
    expect(declared("antracit-300")).toBe(PALETTE.antracit[300]);
    expect(declared("rod")).toBe(ROD);
    expect(declared("ljusgra")).toBe(LJUSGRA);
    expect(declared("ljusgra-100")).toBe(PALETTE.ljusgra[100]);
    expect(declared("bla")).toBe(BLA);
    expect(declared("bla-100")).toBe(PALETTE.bla[100]);
  });

  it("has no green in the theme and resets Tailwind's default palette", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/green|emerald/i);
    expect(code).toContain("--color-*: initial;");
    const hexes = [...code.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toUpperCase());
    for (const hex of hexes) {
      if (hex !== "#000000") expect(BRAND_COLORS).toContain(hex);
    }
  });
});

describe("chart roles", () => {
  it("maps the roles from the brand rules", () => {
    expect(roleColor("primary", "hex")).toBe(ANTRACIT);
    expect(roleColor("secondary", "hex")).toBe(BLA);
    expect(roleColor("previous", "hex")).toBe(LJUSGRA);
    expect(roleColor("highlight", "hex")).toBe(ROD);
  });

  it("returns CSS variables by default so presentation mode can recolour", () => {
    expect(roleColor("primary")).toBe("var(--chart-primary)");
    expect(roleColor("highlight")).toBe("var(--chart-highlight)");
  });
});

describe("categoricalColor", () => {
  it("starts with antracit and blue and cycles", () => {
    expect(categoricalColor(0, "hex")).toBe(ANTRACIT);
    expect(categoricalColor(1, "hex")).toBe(BLA);
    expect(categoricalColor(CATEGORICAL.length, "hex")).toBe(ANTRACIT);
    expect(categoricalColor(-1, "hex")).toBe(CATEGORICAL.at(-1)!.hex);
  });
});

describe("assignSeriesColors / seriesColor", () => {
  it("uses role colours for distinct roles", () => {
    expect(
      assignSeriesColors(
        [{ role: "primary" }, { role: "previous" }, { role: "secondary" }, { role: "highlight" }],
        "hex",
      ),
    ).toEqual([ANTRACIT, LJUSGRA, BLA, ROD]);
  });

  it("gives repeated roles distinct, non-red colours", () => {
    const colors = assignSeriesColors(
      [{ role: "primary" }, { role: "primary" }, { role: "primary" }],
      "hex",
    );
    expect(colors[0]).toBe(ANTRACIT);
    expect(new Set(colors).size).toBe(3);
    expect(colors).not.toContain(ROD);
  });

  it("does not steal a colour that a later role needs", () => {
    const colors = assignSeriesColors(
      [{ role: "primary" }, { role: "primary" }, { role: "secondary" }],
      "hex",
    );
    expect(colors[2]).toBe(BLA);
    expect(colors[1]).not.toBe(BLA);
  });

  it("cycles when there are more series than colours", () => {
    const many = Array.from({ length: CATEGORICAL.length + 3 }, () => ({
      role: "primary" as const,
    }));
    const colors = assignSeriesColors(many, "hex");
    expect(colors).toHaveLength(many.length);
    expect(colors.every((c) => BRAND_COLORS.includes(c))).toBe(true);
  });

  it("seriesColor agrees with assignSeriesColors", () => {
    expect(seriesColor("primary", 0, "hex")).toBe(ANTRACIT);
    expect(seriesColor("primary", 1, "hex")).toBe(
      assignSeriesColors([{ role: "primary" }, { role: "primary" }], "hex")[1],
    );
    expect(seriesColor("highlight", 3, "hex")).toBe(ROD);
    expect(seriesColor("secondary")).toBe("var(--chart-secondary)");
  });
});

describe("labelColorOn", () => {
  it("puts white on dark fills and antracit on light ones", () => {
    expect(labelColorOn(ANTRACIT)).toBe(WHITE);
    expect(labelColorOn(ROD.toLowerCase())).toBe(WHITE);
    expect(labelColorOn(BLA)).toBe(ANTRACIT);
    expect(labelColorOn(LJUSGRA)).toBe(ANTRACIT);
  });
});
