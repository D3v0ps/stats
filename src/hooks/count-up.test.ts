import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COUNT_UP_DURATION_MS, countUpFrame, easeOutCubic, shouldAnimateCountUp } from "./count-up";
import { useCountUp } from "./use-count-up";
import { useMediaQuery, usePrefersReducedMotion } from "./use-media-query";

describe("easeOutCubic", () => {
  it("starts at 0, ends at 1 and is monotonic", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("clamps out-of-range input", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("is front-loaded (fast start, gentle landing)", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });
});

describe("countUpFrame", () => {
  it("ends exactly on the target", () => {
    expect(countUpFrame(1234.56, 1)).toBe(1234.56);
    expect(countUpFrame(1234.56, 1.4)).toBe(1234.56);
  });

  it("shows only integers while counting to an integer", () => {
    for (let p = 0; p < 1; p += 0.07) {
      expect(Number.isInteger(countUpFrame(4711, p))).toBe(true);
    }
  });

  it("keeps decimals for fractional targets", () => {
    expect(Number.isInteger(countUpFrame(12.5, 0.3))).toBe(false);
  });

  it("counts negative targets towards the target", () => {
    const v = countUpFrame(-200, 0.5);
    expect(v).toBeLessThan(0);
    expect(v).toBeGreaterThan(-200);
  });

  it("starts at zero", () => {
    expect(countUpFrame(999, 0)).toBe(0);
  });
});

describe("shouldAnimateCountUp", () => {
  const base = { isStatic: false, hasStaticAncestor: false, reducedMotion: false, target: 10 };

  it("animates by default", () => {
    expect(shouldAnimateCountUp(base)).toBe(true);
  });

  it("stays still for static views, static ancestors and reduced motion", () => {
    expect(shouldAnimateCountUp({ ...base, isStatic: true })).toBe(false);
    expect(shouldAnimateCountUp({ ...base, hasStaticAncestor: true })).toBe(false);
    expect(shouldAnimateCountUp({ ...base, reducedMotion: true })).toBe(false);
  });

  it("has nothing to count for zero or non-finite values", () => {
    expect(shouldAnimateCountUp({ ...base, target: 0 })).toBe(false);
    expect(shouldAnimateCountUp({ ...base, target: Number.NaN })).toBe(false);
    expect(shouldAnimateCountUp({ ...base, target: Infinity })).toBe(false);
  });

  it("has a sensible default duration", () => {
    expect(COUNT_UP_DURATION_MS).toBeGreaterThanOrEqual(400);
    expect(COUNT_UP_DURATION_MS).toBeLessThanOrEqual(1500);
  });
});

describe("hooks on the server", () => {
  function CountProbe({ value }: { value: number }) {
    const format = (n: number) => `${n} st`;
    const ref = useCountUp<HTMLSpanElement>(value, format);
    return createElement("span", { ref }, format(value));
  }

  it("useCountUp renders the final value (no zero in server HTML)", () => {
    expect(renderToStaticMarkup(createElement(CountProbe, { value: 42 }))).toBe(
      "<span>42 st</span>",
    );
  });

  function MediaProbe() {
    const reduced = usePrefersReducedMotion();
    const wide = useMediaQuery("(min-width: 1024px)", true);
    return createElement("i", null, `${reduced}/${wide}`);
  }

  it("media queries fall back to the server value", () => {
    expect(renderToStaticMarkup(createElement(MediaProbe))).toBe("<i>false/true</i>");
  });
});
