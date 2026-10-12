// CSV export of the Utforska table for Excel with Swedish settings: semicolon separated,
// decimal comma, no thousands separators (Excel would read "1 234" as text), UTF-8 with BOM
// so å/ä/ö survive, CRLF line endings.
import { MINUS, NBSP, formatNumber } from "@/lib/core/format-sv";

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";
export const CSV_MIME = "text/csv;charset=utf-8";

/** 1234.5 -> "1234,5"; negative with ASCII minus; null/NaN -> "". */
export function csvNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return formatNumber(value, decimals).replaceAll(NBSP, "").replaceAll(MINUS, "-");
}

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:,\d+)?$/;

/** Quote a field when it contains the separator, a quote or a line break. */
export function csvField(value: string): string {
  // Excel evaluates a cell starting with = + - @ (or a tab/CR) as a formula ("-1+cmd|…" too);
  // only plain numbers such as "-1234,5" may start with a minus.
  const safe = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function buildCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvField).join(CSV_SEPARATOR));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** ASCII file name: "mb-stats-fakturerade-timmar-kund-2026-09.csv". */
export function csvFileName(parts: readonly string[]): string {
  const slug = parts
    .map((p) =>
      p
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter((p) => p.length > 0)
    .join("-");
  return `mb-stats${slug ? `-${slug}` : ""}.csv`;
}
