import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountUp } from "./CountUp";
import { KpiCard, type KpiCardProps } from "./KpiCard";

const NBSP = " ";
const render = (props: KpiCardProps) => renderToStaticMarkup(createElement(KpiCard, props));

describe("<KpiCard>", () => {
  const base: KpiCardProps = {
    title: "Fakturerade timmar",
    value: 12345,
    unit: "h",
  };

  it("renders the final formatted number in server HTML (never zero)", () => {
    const html = render(base);
    expect(html).toContain(`12${NBSP}345${NBSP}h`);
    expect(html).toContain("Fakturerade timmar");
    expect(html).not.toContain(`>0${NBSP}h<`);
  });

  it("shows delta, sparkline, footnote and last update", () => {
    const html = render({
      ...base,
      delta: {
        direction: "up",
        formatted: `+12${NBSP}%`,
        favorable: true,
        againstLabel: "mot aug 2026",
      },
      sparkline: [1, 2, null, 4],
      lastUpdatedAt: "2026-10-12T08:30:00Z",
      footnote: "2 av 3 mån har data",
    });
    expect(html).toContain('aria-label="Ökning 12 procent mot aug 2026"');
    expect(html).toContain('data-slot="sparkline"');
    expect(html).toContain("Senast uppdaterad 12 okt 2026");
    expect(html).toContain("2 av 3 mån har data");
  });

  it("shows 'Saknas' when there is no data and hides the delta", () => {
    const html = render({
      ...base,
      value: null,
      delta: { direction: "up", formatted: `+1${NBSP}%`, favorable: true, againstLabel: "" },
    });
    expect(html).toContain("Saknas");
    expect(html).not.toContain("Ökning");
  });

  it("renders a skeleton while loading", () => {
    const html = render({ ...base, loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Laddar Fakturerade timmar");
    expect(html).not.toContain(`12${NBSP}345`);
  });

  it("turns the title into a stretched drill-down link", () => {
    const html = render({ ...base, href: "/utforska?matt=timmar" });
    expect(html).toMatch(/<a [^>]*href="\/utforska\?matt=timmar"/);
    expect(html).toContain("after:absolute");
  });

  it("supports a click handler as a button", () => {
    const html = render({ ...base, onClick: () => undefined, actionLabel: "Visa timmar per kund" });
    expect(html).toMatch(/<button type="button" aria-label="Visa timmar per kund"/);
  });

  it("marks static cards so animations stay off", () => {
    const html = render({ ...base, static: true, sparkline: [1, 2, 3] });
    expect(html).toContain("data-static");
    expect(html).not.toContain("animate-draw");
  });

  it("hides an all-missing sparkline", () => {
    expect(render({ ...base, sparkline: [null, null] })).not.toContain('data-slot="sparkline"');
  });

  it("formats amounts compactly when asked", () => {
    expect(
      render({ ...base, value: 2_400_000, unit: "kr", formatOptions: { compact: true } }),
    ).toContain(`2,4${NBSP}mkr`);
  });
});

describe("<CountUp>", () => {
  it("server-renders the final value with tabular figures", () => {
    const html = renderToStaticMarkup(createElement(CountUp, { value: 0.873, unit: "pct" }));
    expect(html).toContain(`0,9${NBSP}%`);
    expect(html).toContain('class="num"');
  });
});
