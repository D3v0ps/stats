import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Delta } from "./Delta";
import { EmptyState } from "./EmptyState";
import { Heading, type HeadingProps } from "./Heading";
import { Section, type SectionProps } from "./Section";
import { Sparkline } from "./Sparkline";
import { StatGrid, StatGridItem } from "./StatGrid";
import { buildDelta } from "./delta-text";

const NBSP = "\u00a0";

/** Heading with text children (createElement wants children in props for typing only). */
const heading = (props: Omit<HeadingProps, "children">, text: string) =>
  renderToStaticMarkup(createElement(Heading, props as HeadingProps, text));

describe("<Heading>", () => {
  it("renders the level's tag, uppercase with airy letter spacing", () => {
    const html = heading({ level: 1 }, "Resultat");
    expect(html).toMatch(/^<h1 /);
    expect(html).toContain("uppercase");
    expect(html).toContain("tracking-[0.08em]");
    expect(html).toContain("font-light");
    // The level's text size must not cancel the tight line height (tailwind-merge drops a
    // leading-* that comes before a text-* size).
    expect(html).toContain("leading-tight");
  });

  it("adds a red full stop, keeping a single dot when the text has one", () => {
    const plain = heading({ level: 2, accent: "dot" }, "Resultat");
    expect(plain).toContain('Resultat<span class="text-rod" aria-hidden="true">.</span>');
    const dotted = heading({ level: 2, accent: "dot" }, "Deltagarna ökar.");
    expect(dotted.match(/\./g)).toHaveLength(2); // "0.08em" + the red dot
    expect(dotted).toContain('ökar<span class="text-rod"');
  });

  it("draws the red underscore variant and honours `as`", () => {
    const html = heading({ level: 3, accent: "underscore", as: "p" }, "Etikett");
    expect(html).toMatch(/^<p /);
    expect(html).toContain("after:bg-rod");
  });
});

describe("<Delta>", () => {
  const render = (props: Parameters<typeof Delta>[0]) =>
    renderToStaticMarkup(createElement(Delta, props));

  it("shows glyph and signed text; favourable is antracit (foreground)", () => {
    const delta = buildDelta({
      unit: "h",
      deltaPct: 12,
      higherIsBetter: true,
      againstLabel: "mot aug 2026",
    });
    const html = render({ delta });
    expect(html).toContain('aria-label="Ökning 12 procent mot aug 2026"');
    expect(html).toContain("▲");
    expect(html).toContain(`+12${NBSP}%`);
    expect(html).toContain("text-foreground");
    expect(html).not.toContain("text-rod");
    expect(html).toContain("mot aug 2026");
  });

  it("colours unfavourable changes red and neutral ones muted", () => {
    const worse = buildDelta({
      unit: "h",
      deltaPct: 12,
      higherIsBetter: false,
      againstLabel: "mot aug 2026",
    });
    expect(render({ delta: worse })).toContain("text-rod");
    const unknown = buildDelta({
      unit: "st",
      deltaPct: -4,
      higherIsBetter: null,
      againstLabel: "mot budget",
    });
    const html = render({ delta: unknown, showAgainst: false });
    expect(html).toContain("▼");
    expect(html).toContain("text-muted-foreground");
    expect(html).not.toContain(">mot budget<");
  });

  it("renders a muted dash with a Swedish label when there is nothing to compare", () => {
    const html = render({ delta: null });
    expect(html).toContain('aria-label="Jämförelse saknas"');
    expect(html).toContain(">–<");
  });
});

describe("<Sparkline>", () => {
  const render = (props: Parameters<typeof Sparkline>[0]) =>
    renderToStaticMarkup(createElement(Sparkline, props));

  it("draws gaps for missing months and a red dot on the last value", () => {
    const html = render({ values: [1, 2, null, 4, 5], label: "Timmar per månad" });
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html).toContain('data-slot="sparkline-last"');
    expect(html).toContain('fill="var(--chart-highlight)"');
    expect(html).toContain('stroke="var(--chart-primary)"');
    expect(html).toContain('role="img"');
    expect(html).toContain("<title>Timmar per månad</title>");
  });

  it("is decorative without a label", () => {
    const html = render({ values: [1, 2, 3] });
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<title>");
  });

  it("draws in via pathLength only when animated", () => {
    const animated = render({ values: [1, 2, 3] });
    expect(animated).toContain('pathLength="1"');
    expect(animated).toContain("animate-draw");
    const still = render({ values: [1, 2, 3], animate: false });
    expect(still).not.toContain("pathLength");
    expect(still).not.toContain("animate-draw");
  });

  it("keeps dash lengths in user units so the draw-in ends fully drawn at any size", () => {
    // With vector-effect="non-scaling-stroke" browsers dash in screen units while pathLength
    // scales in user units, so a sparkline scaled up past its viewBox would stay cut off.
    expect(render({ values: [1, 2, 3] })).not.toMatch(/vector-?effect/i);
  });

  it("renders nothing to draw for an all-missing series", () => {
    const html = render({ values: [null, null] });
    expect(html).not.toContain("<path");
    expect(html).not.toContain("<circle");
  });
});

describe("<EmptyState>, <Section>, <StatGrid>", () => {
  it("EmptyState shows title, description and one action without alarm colours", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: "Inga nyckeltal ännu",
        description: "Ladda upp en fil.",
        action: createElement("a", { href: "/ladda-upp" }, "Ladda upp"),
      }),
    );
    expect(html).toContain("Inga nyckeltal ännu");
    expect(html).toContain('href="/ladda-upp"');
    expect(html).not.toMatch(/rod|destructive/);
  });

  it("Section labels its region with the heading", () => {
    const html = renderToStaticMarkup(
      createElement(Section, { title: "Säkerhet" } as SectionProps, "innehåll"),
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<h2 [^>]*id="${id}"[^>]*>Säkerhet</h2>`));
  });

  it("StatGrid is one column on phones and spells out its breakpoints", () => {
    const html = renderToStaticMarkup(
      createElement(
        StatGrid,
        { columns: 3 },
        createElement(StatGridItem, { span: 2, rowSpan: 2 }, "x"),
      ),
    );
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("lg:grid-cols-3");
    expect(html).toContain("sm:col-span-2");
    expect(html).toContain("lg:row-span-2");
  });
});
