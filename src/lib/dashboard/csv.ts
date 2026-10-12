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

/** Quote a field when it contains the separator, a quote or a line break. */
export function csvField(value: string): string {
  // A leading = + - @ would make Excel evaluate the cell as a formula.
  const safe = /^[=+@]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
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
