"use client";

import Link from "next/link";
import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import type { Unit } from "@/lib/contracts";
import { estimateTextWidth, formatChartValue, type CategoryAxisFit } from "./chart-format";

/** Animate only when asked and the user has not requested reduced motion. */
export function useChartAnimation(animate: boolean): boolean {
  const reduced = usePrefersReducedMotion();
  return animate && !reduced;
}

/** Tooltip row for ChartTooltipContent: swatch, series name, value formatted in Swedish. */
export function tooltipFormatter(unit: Unit) {
  return function formatTooltipRow(
    value: unknown,
    name: unknown,
    item: { color?: string; payload?: { fill?: string } },
  ): ReactNode {
    const swatch = item.payload?.fill ?? item.color;
    return (
      <div className="flex w-full items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: swatch }}
          />
          {String(name ?? "")}
        </span>
        <span className="num font-medium text-foreground">{formatChartValue(value, unit)}</span>
      </div>
    );
  };
}

/** Axis tick styling shared by the cartesian charts. */
export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 } as const;

/** AXIS_TICK at another size (miniatures). */
export function axisTick(fontSize: number = AXIS_TICK.fontSize) {
  return fontSize === AXIS_TICK.fontSize ? AXIS_TICK : { ...AXIS_TICK, fontSize };
}

function subscribeFonts(onChange: () => void) {
  const fonts = document.fonts;
  fonts.addEventListener("loading", onChange);
  fonts.addEventListener("loadingdone", onChange);
  return () => {
    fonts.removeEventListener("loading", onChange);
    fonts.removeEventListener("loadingdone", onChange);
  };
}

/**
 * Width in px of a text in the page font at `fontSize`, measured on a canvas (estimated on
 * the server). Measured again once web fonts have loaded: Montserrat swaps in after the first
 * paint and is wider than its fallback, so labels sized before the swap would be cut off.
 */
export function useTextMeasure(fontSize: number): (text: string) => number {
  const fonts = useSyncExternalStore<FontFaceSetLoadStatus | "server">(
    subscribeFonts,
    () => document.fonts.status,
    () => "server",
  );
  return useMemo(() => {
    const context = fonts === "server" ? null : document.createElement("canvas").getContext("2d");
    if (!context) return (text: string) => estimateTextWidth(text, fontSize);
    context.font = `${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
    return (text: string) => context.measureText(text).width;
  }, [fonts, fontSize]);
}

/**
 * Draws the labels of a fitted category axis (see fitCategoryAxis); a cut label carries the
 * full name as its SVG title.
 */
export function fittedCategoryTick(
  categories: readonly string[],
  fit: CategoryAxisFit,
  style: { fill: string; fontSize: number },
) {
  const shown = new Map(categories.map((c, i) => [c, fit.labels[i] ?? c]));
  return function renderCategoryTick(props: {
    x: number | string;
    y: number | string;
    payload: { value?: unknown };
    className?: string;
  }): ReactNode {
    const name = String(props.payload.value ?? "");
    const label = shown.get(name) ?? name;
    return (
      <text
        x={props.x}
        y={props.y}
        // Centred on the bar like Recharts' own tick text.
        dy="0.355em"
        textAnchor="end"
        fill={style.fill}
        fontSize={style.fontSize}
        className={props.className}
      >
        {label === name ? null : <title>{name}</title>}
        {label}
      </text>
    );
  };
}

export interface CategoryDrill {
  /** True when at least one category opens something: marks bars/slices clickable. */
  active: boolean;
  /** Open category `index` (its link, else onCategoryClick). */
  open: (index: number) => void;
  navRef: RefObject<HTMLElement | null>;
}

/**
 * Drill-down from a chart category. A click on a bar or slice follows the category's link in
 * the CategoryLinkList (so Next's client navigation handles it), else calls onCategoryClick.
 */
export function useCategoryDrill(
  hrefs: readonly (string | null)[] | undefined,
  onCategoryClick: ((index: number) => void) | undefined,
): CategoryDrill {
  const navRef = useRef<HTMLElement | null>(null);
  const open = useCallback(
    (index: number) => {
      if (hrefs?.[index]) {
        navRef.current
          ?.querySelector<HTMLAnchorElement>(`a[data-category-index="${index}"]`)
          ?.click();
        return;
      }
      onCategoryClick?.(index);
    },
    [hrefs, onCategoryClick],
  );
  return { active: Boolean(onCategoryClick) || Boolean(hrefs?.some(Boolean)), open, navRef };
}

/**
 * The categories' links for keyboard and screen reader users. Visually hidden until a link
 * takes focus (bars and slices are not focusable), then shown under the chart.
 */
export function CategoryLinkList({
  title,
  categories,
  hrefs,
  navRef,
}: {
  title: string;
  categories: readonly string[];
  hrefs: readonly (string | null)[] | undefined;
  navRef: RefObject<HTMLElement | null>;
}) {
  const links = categories.flatMap((label, index) => {
    const href = hrefs?.[index];
    return href ? [{ label, href, index }] : [];
  });
  if (links.length === 0) return null;
  return (
    <nav
      ref={navRef}
      aria-label={`Öppna i ${title}`}
      data-slot="chart-links"
      className="sr-only focus-within:not-sr-only"
    >
      <ul className="flex flex-wrap gap-1.5 pt-3">
        {links.map((l) => (
          <li key={l.index}>
            <Link
              href={l.href}
              data-category-index={l.index}
              className="inline-flex rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
