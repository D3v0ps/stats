import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";
import { sparklineGeometry } from "./sparkline-geometry";

const box = { width: 100, height: 40, padding: 5 };

describe("sparklineGeometry", () => {
  it("draws one segment through all values, highest value at the top", () => {
    const g = sparklineGeometry([0, 10, 5], box);
    expect(g.segments).toEqual(["M5 35 L50 5 L95 20"]);
    expect(g.isolated).toEqual([]);
    expect(g.last).toEqual({ x: 95, y: 20, index: 2 });
  });

  it("splits at missing months instead of drawing through them", () => {
    const g = sparklineGeometry([1, 2, null, 3, 4], box);
    expect(g.segments).toHaveLength(2);
    expect(g.segments[0]).toMatch(/^M5 /);
    expect(g.segments[1]).toMatch(/^M72\.5 /);
  });

  it("keeps lone values visible as isolated points", () => {
    const g = sparklineGeometry([1, null, 2, null, 3, 4], box);
    expect(g.isolated.map((p) => p.index)).toEqual([0, 2]);
    expect(g.segments).toHaveLength(1);
  });

  it("marks the last existing value even when the newest month is missing", () => {
    const g = sparklineGeometry([1, 2, 3, null], box);
    expect(g.last?.index).toBe(2);
  });

  it("centres a flat series vertically", () => {
    const g = sparklineGeometry([7, 7, 7], box);
    expect(g.segments[0]).toBe("M5 20 L50 20 L95 20");
  });

  it("centres a single value", () => {
    const g = sparklineGeometry([42], box);
    expect(g.segments).toEqual([]);
    expect(g.isolated).toEqual([{ x: 50, y: 20, index: 0 }]);
    expect(g.last).toEqual({ x: 50, y: 20, index: 0 });
  });

  it("returns nothing for empty or all-missing input", () => {
    expect(sparklineGeometry([], box)).toEqual({ segments: [], isolated: [], last: null });
    expect(sparklineGeometry([null, undefined, Number.NaN], box)).toEqual({
      segments: [],
      isolated: [],
      last: null,
    });
  });

  it("handles negative values", () => {
    const g = sparklineGeometry([-10, 0, 10], box);
    expect(g.segments[0]).toBe("M5 35 L50 20 L95 5");
  });
});

describe("<Sparkline>", () => {
  it("is decorative without a label and marks the last point red", () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { values: [1, 3, 2] }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fill="var(--chart-highlight)"');
    expect(html).toContain('stroke="var(--chart-primary)"');
    expect(html).toContain("animate-draw");
  });

  it("can be labelled and rendered without animation", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [1, null, 2, 3], label: "Trend 12 mån", animate: false }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Trend 12 mån"');
    expect(html).toContain("<title>Trend 12 mån</title>");
    expect(html).not.toContain("animate-draw");
    expect(html).not.toContain("pathLength");
  });
});
