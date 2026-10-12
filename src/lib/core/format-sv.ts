// Swedish number formatting, hand-rolled so server and browser render the exact
// same characters (ICU versions differ between Node and browsers, which would
// cause hydration mismatches). Conventions:
// - thousands separator: NO-BREAK SPACE (U+00A0)
// - decimal separator: comma
// - minus sign: U+2212 "−"
// - missing value: en dash "–"

export const NBSP = " ";
export const MINUS = "−";
export const MISSING = "–";

export type Unit = "st" | "kr" | "h" | "pct" | "faktor" | "man";

export interface FormatOptions {
  /** Fixed number of decimals. Defaults depend on the unit. */
  decimals?: number;
  /** Compact amounts: 2,4 mkr / 845 tkr. Only affects "kr". */
  compact?: boolean;
  /** Omit the unit suffix. */
  bare?: boolean;
}

/** Group digits with NBSP and use decimal comma. Rounds half away from zero. */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return MISSING;
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor + Number.EPSILON * factor) / factor;
  const negative = value < 0 && rounded !== 0;
  const [intPart, fracPart] = rounded.toFixed(decimals).split(".");
  const grouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const body = fracPart !== undefined ? `${grouped},${fracPart}` : grouped;
  return negative ? `${MINUS}${body}` : body;
}

/** 1234567 -> "1 234 567 kr"; compact: "1,2 mkr", "845 tkr". */
export function formatAmount(value: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return MISSING;
  const suffix = opts.bare ? "" : `${NBSP}kr`;
  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
      const d = opts.decimals ?? (abs >= 100_000_000 ? 0 : 1);
      return `${formatNumber(value / 1_000_000, d)}${opts.bare ? "" : `${NBSP}mkr`}`;
    }
    if (abs >= 10_000) {
      return `${formatNumber(value / 1_000, opts.decimals ?? 0)}${opts.bare ? "" : `${NBSP}tkr`}`;
    }
  }
  return `${formatNumber(value, opts.decimals ?? 0)}${suffix}`;
}

export function formatHours(value: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return MISSING;
  const d = opts.decimals ?? (Math.abs(value) < 100 && !Number.isInteger(value) ? 1 : 0);
  return `${formatNumber(value, d)}${opts.bare ? "" : `${NBSP}h`}`;
}

/** Percent values are stored in percent units: 12.5 means 12,5 %. */
export function formatPercent(value: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatNumber(value, opts.decimals ?? 1)}${opts.bare ? "" : `${NBSP}%`}`;
}

export function formatCount(value: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return MISSING;
  const d = opts.decimals ?? (Number.isInteger(value) ? 0 : 1);
  return `${formatNumber(value, d)}${opts.bare ? "" : `${NBSP}st`}`;
}

export function formatFactor(value: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return MISSING;
  return formatNumber(value, opts.decimals ?? 2);
}

/** Format any metric value by unit. null/undefined/NaN -> "–". */
export function formatValue(
  value: number | null | undefined,
  unit: Unit,
  opts: FormatOptions = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  switch (unit) {
    case "kr":
      return formatAmount(value, opts);
    case "h":
      return formatHours(value, opts);
    case "pct":
      return formatPercent(value, opts);
    case "st":
      return formatCount(value, { ...opts, bare: opts.bare ?? true });
    case "faktor":
      return formatFactor(value, opts);
    case "man":
      return `${formatNumber(value, opts.decimals ?? 1)}${opts.bare ? "" : `${NBSP}mån`}`;
  }
}

export function unitLabel(unit: Unit): string {
  switch (unit) {
    case "kr":
      return "kr";
    case "h":
      return "h";
    case "pct":
      return "%";
    case "st":
      return "st";
    case "faktor":
      return "faktor";
    case "man":
      return "mån";
  }
}

/** Relative change in percent: +12 % / −4 % / ±0 %. Input 12 means +12 %. */
export function formatDeltaPercent(deltaPct: number | null | undefined, decimals = 0): string {
  if (deltaPct === null || deltaPct === undefined || !Number.isFinite(deltaPct)) return MISSING;
  const body = formatNumber(Math.abs(deltaPct), decimals);
  if (body === formatNumber(0, decimals)) return `±${body}${NBSP}%`;
  return `${deltaPct > 0 ? "+" : MINUS}${body}${NBSP}%`;
}

/** Change in percentage points (procentenheter), used for percent metrics. */
export function formatDeltaPp(deltaPp: number | null | undefined, decimals = 1): string {
  if (deltaPp === null || deltaPp === undefined || !Number.isFinite(deltaPp)) return MISSING;
  const body = formatNumber(Math.abs(deltaPp), decimals);
  if (body === formatNumber(0, decimals)) return `±${body}${NBSP}p.e.`;
  return `${deltaPp > 0 ? "+" : MINUS}${body}${NBSP}p.e.`;
}

/** Absolute change with unit, e.g. "+1 200 kr", "−3 st". */
export function formatDeltaAbsolute(
  delta: number | null | undefined,
  unit: Unit,
  opts: FormatOptions = {},
): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return MISSING;
  const body = formatValue(Math.abs(delta), unit, opts);
  if (delta === 0) return `±${body}`;
  return `${delta > 0 ? "+" : MINUS}${body}`;
}

/** Arrow glyph for a direction. Never rely on color alone (no green in the palette). */
export function deltaArrow(delta: number | null | undefined): "▲" | "▼" | "●" | "" {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "";
  if (delta > 0) return "▲";
  if (delta < 0) return "▼";
  return "●";
}

/** "2026-10-12T08:30:00Z" -> "12 okt 2026" (Europe/Stockholm). */
export function formatDateSv(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return MISSING;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const abbr = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return `${day} ${abbr[m - 1]} ${y}`;
}
