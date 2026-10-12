import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Delta } from "./Delta";
import { buildDelta, deltaAriaLabel, deltaTone } from "./delta-text";

const NBSP = " ";

describe("buildDelta", () => {
  it("formats relative change for non-percent units", () => {
    expect(
      buildDelta({
        unit: "kr",
        deltaPct: 12.4,
        higherIsBetter: true,
        againstLabel: "mot aug 2026",
      }),
    ).toEqual({
      direction: "up",
      formatted: `+12${NBSP}%`,
      favorable: true,
      againstLabel: "mot aug 2026",
    });
  });

  it("uses percentage points for pct units", () => {
    const d = buildDelta({
      unit: "pct",
      deltaPct: 50,
      deltaPp: -1.26,
      higherIsBetter: false,
      againstLabel: "mot sep 2025",
    });
    expect(d).toMatchObject({ direction: "down", formatted: `−1,3${NBSP}p.e.`, favorable: true });
  });

  it("marks values that round to zero as flat and neutral", () => {
    const d = buildDelta({ unit: "h", deltaPct: 0.4, higherIsBetter: true, againstLabel: "" });
    expect(d).toMatchObject({ direction: "flat", formatted: `±0${NBSP}%`, favorable: null });
  });

  it("is neutral when the metric has no preferred direction", () => {
    expect(
      buildDelta({ unit: "st", deltaPct: -8, higherIsBetter: null, againstLabel: "" })?.favorable,
    ).toBeNull();
  });

  it("flags bad news", () => {
    expect(
      buildDelta({ unit: "h", deltaPct: 9, higherIsBetter: false, againstLabel: "" })?.favorable,
    ).toBe(false);
  });

  it("returns null without a comparison value", () => {
    expect(buildDelta({ unit: "kr", deltaPct: null, higherIsBetter: true, againstLabel: "" })).toBe(
      null,
    );
    expect(buildDelta({ unit: "pct", deltaPct: 3, higherIsBetter: true, againstLabel: "" })).toBe(
      null,
    );
    expect(
      buildDelta({ unit: "kr", deltaPct: Number.NaN, higherIsBetter: true, againstLabel: "" }),
    ).toBe(null);
  });

  it("honours explicit decimals", () => {
    expect(
      buildDelta({
        unit: "kr",
        deltaPct: 2.345,
        higherIsBetter: true,
        againstLabel: "",
        decimals: 1,
      })?.formatted,
    ).toBe(`+2,3${NBSP}%`);
  });
});

describe("deltaAriaLabel", () => {
  it("reads an increase in Swedish", () => {
    expect(
      deltaAriaLabel({ direction: "up", formatted: `+12${NBSP}%`, againstLabel: "mot aug 2026" }),
    ).toBe("Ökning 12 procent mot aug 2026");
  });

  it("reads a decrease in percentage points", () => {
    expect(
      deltaAriaLabel({
        direction: "down",
        formatted: `−1,3${NBSP}p.e.`,
        againstLabel: "mot budget",
      }),
    ).toBe("Minskning 1,3 procentenheter mot budget");
  });

  it("expands amount and other units", () => {
    expect(deltaAriaLabel({ direction: "up", formatted: `+2,4${NBSP}mkr`, againstLabel: "" })).toBe(
      "Ökning 2,4 miljoner kronor",
    );
    expect(
      deltaAriaLabel({ direction: "down", formatted: `−845${NBSP}tkr`, againstLabel: "" }),
    ).toBe("Minskning 845 tusen kronor");
    expect(
      deltaAriaLabel({ direction: "down", formatted: `−1${NBSP}200${NBSP}kr`, againstLabel: "" }),
    ).toBe("Minskning 1 200 kronor");
    expect(deltaAriaLabel({ direction: "up", formatted: `+12${NBSP}h`, againstLabel: "" })).toBe(
      "Ökning 12 timmar",
    );
    expect(deltaAriaLabel({ direction: "up", formatted: "+3", againstLabel: "" })).toBe("Ökning 3");
  });

  it("says unchanged for flat deltas", () => {
    expect(
      deltaAriaLabel({ direction: "flat", formatted: `±0${NBSP}%`, againstLabel: "mot aug 2026" }),
    ).toBe("Oförändrat mot aug 2026");
  });

  it("handles a missing value", () => {
    expect(deltaAriaLabel({ direction: "flat", formatted: "–", againstLabel: "" })).toBe(
      "Förändring saknas",
    );
  });
});

describe("deltaTone", () => {
  it("maps favorable to tones", () => {
    expect(deltaTone(true)).toBe("favorable");
    expect(deltaTone(false)).toBe("unfavorable");
    expect(deltaTone(null)).toBe("neutral");
  });
});

describe("<Delta>", () => {
  const render = (props: Parameters<typeof Delta>[0]) =>
    renderToStaticMarkup(createElement(Delta, props));

  it("renders glyph, text and an accessible label", () => {
    const html = render({
      delta: {
        direction: "up",
        formatted: `+12${NBSP}%`,
        favorable: true,
        againstLabel: "mot aug 2026",
      },
    });
    expect(html).toContain('aria-label="Ökning 12 procent mot aug 2026"');
    expect(html).toContain("▲");
    expect(html).toContain("mot aug 2026");
    expect(html).toContain("text-foreground");
  });

  it("uses red only for unfavorable changes", () => {
    const bad = render({
      delta: { direction: "down", formatted: `−4${NBSP}%`, favorable: false, againstLabel: "" },
    });
    expect(bad).toContain("text-rod");
    expect(bad).toContain("▼");
    const neutral = render({
      delta: { direction: "flat", formatted: `±0${NBSP}%`, favorable: null, againstLabel: "" },
    });
    expect(neutral).toContain("text-muted-foreground");
    expect(neutral).toContain("●");
    expect(neutral).not.toContain("text-rod");
  });

  it("can hide the comparison label", () => {
    const html = render({
      delta: {
        direction: "up",
        formatted: `+1${NBSP}%`,
        favorable: true,
        againstLabel: "mot jul 2026",
      },
      showAgainst: false,
    });
    expect(html).not.toContain(">mot jul 2026<");
    expect(html).toContain('aria-label="Ökning 1 procent mot jul 2026"');
  });

  it("renders a dash when there is no comparison", () => {
    const html = render({ delta: null });
    expect(html).toContain('aria-label="Jämförelse saknas"');
    expect(html).toContain("–");
  });
});
