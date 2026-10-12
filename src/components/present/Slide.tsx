"use client";

import type { CSSProperties } from "react";
import { Delta } from "@/components/brand/Delta";
import { Heading } from "@/components/brand/Heading";
import { MbBarChart, MbDonut, MbLineChart, MbStackedCompanyBar } from "@/components/brand/charts";
import type { ResolvedSlide } from "@/lib/contracts/slides";
import { TOTAL_ROW_LABEL } from "@/lib/metrics";
import {
  headlineScale,
  miniatureChartText,
  numberScale,
  slideEmphasis,
  slideKicker,
  slideVisual,
  tableScale,
  type SlideVisual,
} from "@/lib/present/slide-view";
import { cn } from "@/lib/utils";
import { ScaledChart } from "./ScaledChart";
import { SLIDE_CLASS as styles, SLIDE_CSS, SLIDE_STYLE_ID } from "./slide-css";

export interface SlideProps {
  slide: ResolvedSlide;
  /** 0-based position, for the accessible name ("Bild 3 av 9"). */
  index?: number;
  count?: number;
  /** A single gentle fade when the slide appears (deck only). */
  fade?: boolean;
  /** Data-quality note at the bottom (print/PDF, read without a presenter). */
  showFootnote?: boolean;
  /**
   * "screen": readable minimum sizes and charts scaled up with the screen (deck, print).
   * "exact": purely proportional miniature (editor preview, archive thumbnails).
   */
  fit?: "screen" | "exact";
  className?: string;
}

/**
 * A board slide: ONE message (huge uppercase headline with the red dot), period and company
 * in small caps, the big number with its change, and ONE chart. Speaker notes are never
 * rendered here. Renders only from a ResolvedSlide, so deck, archive and print agree.
 */
export function Slide({
  slide,
  index,
  count,
  fade = false,
  showFootnote = false,
  fit = "screen",
  className,
}: SlideProps) {
  const visual = slideVisual(slide);
  const emphasis = slideEmphasis(slide);
  const number = slide.number;
  const label =
    index !== undefined && count !== undefined ? `Bild ${index + 1} av ${count}` : "Bild";
  const vars = {
    "--headline-scale": headlineScale(slide.headline),
    "--number-scale": number ? numberScale(number.value === null ? "Saknas" : number.formatted) : 1,
    "--table-scale": tableScale(slide.table?.rows.length ?? 0),
  } as CSSProperties;

  return (
    <section
      aria-roledescription="bild"
      aria-label={label}
      data-slot="slide"
      data-viz={slide.viz}
      data-fit={fit}
      className={cn(styles.slide, className)}
      style={vars}
    >
      <style href={SLIDE_STYLE_ID} precedence="default">
        {SLIDE_CSS}
      </style>
      <div className={cn(styles.frame, fade && styles.fade)}>
        <p className={styles.kicker}>{slideKicker(slide)}</p>
        <Heading level={1} as="h2" accent="dot" className={styles.headline}>
          {slide.headline}
        </Heading>
        <div className={styles.body} data-emphasis={emphasis} data-visual={visual ?? "none"}>
          {number ? (
            <div className={styles.figure}>
              {number.value === null ? (
                <p className={cn(styles.number, styles.missing)}>
                  Saknas
                  <span className="sr-only"> – ingen publicerad data för perioden</span>
                </p>
              ) : (
                <p className={styles.number} data-testid="slide-number">
                  {number.formatted}
                </p>
              )}
              {slide.delta && number.value !== null ? (
                <Delta delta={slide.delta} size="lg" className={styles.delta} />
              ) : null}
            </div>
          ) : null}
          {visual ? (
            <div className={styles.chart}>
              <SlideVisualElement slide={slide} visual={visual} scaleUp={fit === "screen"} />
            </div>
          ) : null}
        </div>
      </div>
      {showFootnote && slide.footnote ? <p className={styles.footnote}>{slide.footnote}</p> : null}
    </section>
  );
}

function SlideVisualElement({
  slide,
  visual,
  scaleUp,
}: {
  slide: ResolvedSlide;
  visual: SlideVisual;
  scaleUp: boolean;
}) {
  const title = `${slide.metricName}, ${slide.periodLabel}`;
  if (visual === "table") return slide.table ? <SlideTable slide={slide} /> : null;
  const chart = slide.chart;
  if (!chart) return null;
  return (
    <ScaledChart scaleUp={scaleUp}>
      {({ width, height }) => {
        // Screen fit scales the chart up as a whole; a miniature shrinks its axis text instead.
        const text = scaleUp ? {} : miniatureChartText(width);
        const common = { data: chart, title, animate: false, height, ...text };
        switch (visual) {
          case "line":
            return <MbLineChart {...common} />;
          case "columns":
            return <MbBarChart {...common} />;
          case "bars":
            return <MbBarChart {...common} orientation="horizontal" showValues />;
          case "stacked":
            return <MbStackedCompanyBar {...common} />;
          case "donut":
            return (
              <MbDonut
                {...common}
                height={Math.max(60, Math.min(height, width * 0.48))}
                // The big number beside the donut already is the total.
                showTotal={!slide.number}
                centerLabel="Totalt"
              />
            );
        }
      }}
    </ScaledChart>
  );
}

function SlideTable({ slide }: { slide: ResolvedSlide }) {
  const table = slide.table;
  if (!table) return null;
  return (
    <table className={styles.table}>
      <caption className="sr-only">
        {slide.metricName}, {slide.periodLabel}
      </caption>
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={`${row.label}-${i}`} data-total={row.label === TOTAL_ROW_LABEL ? "" : undefined}>
            <th scope="row">{row.label}</th>
            {row.values.map((v, j) => (
              <td key={j}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
