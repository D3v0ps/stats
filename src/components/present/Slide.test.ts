import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedSlide } from "@/lib/contracts/slides";
import { Slide } from "./Slide";

const NBSP = " ";
const NOTES = "Hemligt talarmanus: nämn KROM-avtalet först.";

const slide: ResolvedSlide = {
  id: "aktiva-deltagare",
  viz: "kpi",
  headline: "DELTAGARNA I KROM ÖKAR.",
  suggestedHeadline: "DELTAGARNA I KROM ÖKAR.",
  metricName: "Aktiva deltagare",
  periodLabel: "september 2026",
  companyLabel: "Summa bolag",
  number: { value: 120, formatted: "120", unit: "st" },
  delta: {
    direction: "up",
    formatted: `+12${NBSP}%`,
    favorable: true,
    againstLabel: "mot augusti 2026",
  },
  chart: {
    categories: ["aug 2026", "sep 2026"],
    series: [
      { key: "aktiva_deltagare", label: "Aktiva deltagare", role: "primary", values: [107, 120] },
    ],
    unit: "st",
    highlightIndex: 1,
  },
  table: null,
  footnote: "MB AB saknar data",
  notes: NOTES,
  sourceUploadIds: [],
};

const render = (props: Parameters<typeof Slide>[0]) =>
  renderToStaticMarkup(createElement(Slide, props));

describe("<Slide>", () => {
  it("shows one message: kicker, headline with the red dot, number and change", () => {
    const html = render({ slide, index: 2, count: 9 });
    expect(html).toContain('aria-label="Bild 3 av 9"');
    expect(html).toContain("september 2026 · Summa bolag");
    expect(html).toContain("DELTAGARNA I KROM ÖKAR");
    expect(html).toContain('class="text-rod" aria-hidden="true">.</span>');
    expect(html).toContain(">120<");
    expect(html).toContain(`+12${NBSP}%`);
    expect(html).toContain("mot augusti 2026");
  });

  it("never renders speaker notes, even when the slide still carries them", () => {
    for (const fit of ["screen", "exact"] as const) {
      const html = render({ slide, fit, showFootnote: true });
      expect(html).not.toContain("talarmanus");
      expect(html).not.toContain("KROM-avtalet");
    }
  });

  it("shows the data-coverage footnote only where nobody presents (print)", () => {
    expect(render({ slide })).not.toContain("MB AB saknar data");
    expect(render({ slide, showFootnote: true })).toContain("MB AB saknar data");
  });

  it("says Saknas instead of a number when there is no data", () => {
    const html = render({
      slide: { ...slide, number: { value: null, formatted: "–", unit: "st" }, delta: null },
    });
    expect(html).toContain("Saknas");
    expect(html).not.toContain('data-testid="slide-number"');
  });
});
