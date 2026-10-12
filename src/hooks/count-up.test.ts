import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  COUNT_UP_DURATION_MS,
  countUpFrame,
  countUpStart,
  easeOutCubic,
  shouldAnimateCountUp,
} from "./count-up";
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

  it("counts from a previous value, up or down, ending on the target", () => {
    expect(countUpFrame(150, 0, 100)).toBe(100);
    const up = countUpFrame(150, 0.5, 100);
    expect(up).toBeGreaterThan(100);
    expect(up).toBeLessThan(150);
    const down = countUpFrame(100, 0.5, 150);
    expect(down).toBeLessThan(150);
    expect(down).toBeGreaterThan(100);
    expect(countUpFrame(100, 1, 150)).toBe(100);
    expect(Number.isInteger(countUpFrame(150, 0.33, 100))).toBe(true);
    expect(Number.isInteger(countUpFrame(150, 0.33, 99.5))).toBe(false);
  });
});

describe("countUpStart", () => {
  it("never animates the first run of a hydrated number (no smaller first paint)", () => {
    expect(countUpStart({ previous: null, hydrated: true, target: 4711 })).toBeNull();
  });

  it("counts a client-side mount up from zero", () => {
    expect(countUpStart({ previous: null, hydrated: false, target: 4711 })).toBe(0);
  });

  it("counts a changed value from the previous one and leaves an unchanged one alone", () => {
    expect(countUpStart({ previous: 4711, hydrated: true, target: 5000 })).toBe(4711);
    expect(countUpStart({ previous: 4711, hydrated: false, target: 4000 })).toBe(4711);
    expect(countUpStart({ previous: 4711, hydrated: true, target: 4711 })).toBeNull();
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

  it("animates a change from a previous value, also towards zero", () => {
    expect(shouldAnimateCountUp({ ...base, from: 4, target: 0 })).toBe(true);
    expect(shouldAnimateCountUp({ ...base, from: 10, target: 10 })).toBe(false);
    expect(shouldAnimateCountUp({ ...base, from: Number.NaN, target: 10 })).toBe(false);
    expect(shouldAnimateCountUp({ ...base, from: 4, target: 9, reducedMotion: true })).toBe(false);
    expect(shouldAnimateCountUp({ ...base, from: 4, target: 9, hasStaticAncestor: true })).toBe(
      false,
    );
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
