// MB brand palette and chart colour roles. src/app/globals.css mirrors these values as
// Tailwind colours (bg-antracit, text-rod, bg-ljusgra-100, ...) and CSS variables.
// Charts use the CSS variables by default so `.theme-present` can recolour them; the hex
// values are for places without CSS (canvas, exports, tests).
import type { ChartSeries, SeriesRole } from "@/lib/contracts";

export const PALETTE = {
  antracit: { base: "#1E252B", 300: "#494E52", 200: "#8D9093", 100: "#C6C8C9" },
  rod: { base: "#FF0C01", 300: "#FE5D4A", 200: "#FF998E", 100: "#FFCCC6" },
  ljusgra: { base: "#D1D3D3", 300: "#D3D6D7", 200: "#E4E5E6", 100: "#F1F2F3" },
  bla: { base: "#6BA2B9", 300: "#7EACC0", 200: "#AECBD7", 100: "#D7E5EB" },
  white: "#FFFFFF",
} as const;

export const ANTRACIT = PALETTE.antracit.base;
export const ROD = PALETTE.rod.base;
export const LJUSGRA = PALETTE.ljusgra.base;
export const BLA = PALETTE.bla.base;
export const WHITE = PALETTE.white;

/** Every colour the brand allows. Anything else (green in particular) is off-brand. */
export const BRAND_COLORS: readonly string[] = [
  WHITE,
  ...(["antracit", "rod", "ljusgra", "bla"] as const).flatMap((family) => {
    const { base, 300: t300, 200: t200, 100: t100 } = PALETTE[family];
    return [base, t300, t200, t100];
  }),
];

export type ColorMode = "css" | "hex";

interface SwatchDef {
  css: string;
  hex: string;
}

/**
 * Chart roles: primary series antracit, secondary blue, previous period light grey,
 * red only to highlight (current month, the bar being discussed).
 */
export const CHART_ROLES: Record<SeriesRole, SwatchDef> = {
  primary: { css: "var(--chart-primary)", hex: ANTRACIT },
  secondary: { css: "var(--chart-secondary)", hex: BLA },
  previous: { css: "var(--chart-previous)", hex: LJUSGRA },
  highlight: { css: "var(--chart-highlight)", hex: ROD },
};

/**
 * Categorical sequence for charts with more series/slices than roles, ordered so that
 * neighbours stay distinguishable. Red is deliberately absent: it is reserved for highlights.
 * The first five follow the shadcn chart variables (--chart-1..5).
 */
export const CATEGORICAL: readonly SwatchDef[] = [
  { css: "var(--chart-1)", hex: ANTRACIT },
  { css: "var(--chart-2)", hex: BLA },
  { css: "var(--chart-4)", hex: PALETTE.antracit[200] },
  { css: "var(--chart-5)", hex: PALETTE.bla[200] },
  { css: "var(--chart-3)", hex: LJUSGRA },
  { css: PALETTE.antracit[300], hex: PALETTE.antracit[300] },
  { css: PALETTE.bla[300], hex: PALETTE.bla[300] },
  { css: PALETTE.antracit[100], hex: PALETTE.antracit[100] },
];

/** Position of each non-highlight role colour inside CATEGORICAL. */
const ROLE_CATEGORICAL_INDEX: Record<Exclude<SeriesRole, "highlight">, number> = {
  primary: 0,
  secondary: 1,
  previous: 4,
};

export function roleColor(role: SeriesRole, mode: ColorMode = "css"): string {
  return CHART_ROLES[role][mode];
}

/** Colour of the n-th category (donut slice, unnamed series). Cycles after the sequence. */
export function categoricalColor(index: number, mode: ColorMode = "css"): string {
  const i = ((Math.trunc(index) % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length;
  return (CATEGORICAL[i] ?? CATEGORICAL[0]!)[mode];
}

/**
 * Colour of one series. The first series with a role gets the role colour; later series
 * with the same role get the next unused categorical colour so they never collide.
 * Use assignSeriesColors() for a whole chart.
 */
export function seriesColor(role: SeriesRole, occurrence = 0, mode: ColorMode = "css"): string {
  if (role === "highlight" || occurrence <= 0) return roleColor(role, mode);
  return assignSeriesColors(
    Array.from({ length: occurrence + 1 }, () => ({ role })),
    mode,
  )[occurrence]!;
}

/** Colours for every series of a chart, in order (see seriesColor for the rules). */
export function assignSeriesColors(
  series: readonly Pick<ChartSeries, "role">[],
  mode: ColorMode = "css",
): string[] {
  const used = new Set<number>();
  const pending: number[] = [];
  const out: string[] = series.map((s, i) => {
    if (s.role === "highlight") return roleColor("highlight", mode);
    const index = ROLE_CATEGORICAL_INDEX[s.role];
    if (!used.has(index)) {
      used.add(index);
      return roleColor(s.role, mode);
    }
    pending.push(i);
    return "";
  });
  let cursor = 0;
  for (const i of pending) {
    while (used.has(cursor) && used.size < CATEGORICAL.length) cursor++;
    const index = used.size < CATEGORICAL.length ? cursor : i % CATEGORICAL.length;
    used.add(index);
    out[i] = CATEGORICAL[index]![mode];
  }
  return out;
}

const WHITE_LABEL_FILLS = new Set<string>([ANTRACIT, PALETTE.antracit[300], ROD]);

/**
 * Text colour that stays legible on a brand fill: white on antracit and red, antracit on
 * everything lighter (blue is only ever a fill with antracit labels).
 */
export function labelColorOn(fillHex: string): string {
  return WHITE_LABEL_FILLS.has(fillHex.toUpperCase()) ? WHITE : ANTRACIT;
}
