// Finds the table inside a sheet: which row is the header (title blocks above
// it are common), whether a group header sits above it, and which rows below
// are data versus sum rows, repeated page headers and footers.
import type {
  DetectedColumn,
  DetectedRow,
  DetectedTable,
  RawCell,
  RawSheet,
  RawWorkbook,
  SkippedRow,
} from "@/lib/contracts";
import { normalizeHeader } from "@/lib/core/normalize";
import { similarity } from "@/lib/core/levenshtein";
import {
  EMPTY_CELL,
  cellNumber,
  cellText,
  classifyCell,
  columnLetter,
  shownDecimals,
  type CellClass,
} from "./cells";

export interface DetectOptions {
  /** Rows scanned for the header (default 40). */
  maxScanRows?: number;
  /** Normalized headers of a known template; rows matching them score higher. */
  expectedHeaders?: string[];
}

const DEFAULT_SCAN_ROWS = 40;
const LOOKAHEAD_ROWS = 10;

const SUM_PREFIX = /^(?:summa|totalt|totalsumma|delsumma|subtotal)(?=$|[\s:.,\-–(])/i;
const SUM_EXACT = /^(?:total|sum)\s*:?$/i;
const FOOTER_RE =
  /^(?:utskriv|utskrift|sida\s+\d+|page\s+\d+|\d+\s*\(\s*\d+\s*\)$|skapad|genererad|rapporten\s+(?:är\s+)?skapad|printed|exporterad|exportdatum|källa:|antal\s+rader|antal\s+poster)/i;
/** Page markers ("Sida 1 av 3", a lone "Sida 2") identify a footer line anywhere in the table. */
const PAGE_RE = /(?:^|\s)(?:sida|page)\s+\d+\s*(?:av|of|\/)\s*\d+(?=\s|$)|^(?:sida|page)\s+\d+$/i;
/** Labels that may start a sum row ("Total MBAB") but also a name ("Total Bygg AB"): numbers decide. */
const SUM_WORD = /^(?:total|sum)(?=$|[\s:.,\-–(])/i;
/** Skip detail for a sum row recognised by its numbers alone. */
export const SUM_OF_ROWS_DETAIL = "Summa av raderna ovan";
/** Most "Total …" rows checked against the rows above (bounds the work on odd files). */
const MAX_SUM_CHECKS = 20;

// ---- Grid helpers -----------------------------------------------------------

/** Copy text of merged cells into every cell of the merge (numbers are never duplicated). */
function fillMergedText(sheet: RawSheet): RawCell[][] {
  const rows = sheet.rows.map((r) => r.slice());
  for (const m of sheet.merges) {
    const anchor = sheet.rows[m.s.r]?.[m.s.c];
    if (!anchor || anchor.t !== "s") continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      const row = rows[r] ?? (rows[r] = []);
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        if (cellText(row[c]) === "") row[c] = anchor;
      }
    }
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) if (!row[c]) row[c] = EMPTY_CELL;
  }
  return rows;
}

function nonEmptyCols(row: RawCell[] | undefined): number[] {
  const out: number[] = [];
  if (!row) return out;
  for (let c = 0; c < row.length; c++) if (cellText(row[c]) !== "") out.push(c);
  return out;
}

function isSumLabel(text: string): boolean {
  return SUM_PREFIX.test(text) || SUM_EXACT.test(text);
}

/**
 * The row's first label: the first text cell that starts with a letter. Sum
 * and footer markers always do, so numbers and dates can be skipped without
 * classifying them (this runs for every row of large files).
 */
function firstText(row: RawCell[], cols: number[]): string | null {
  for (const c of cols) {
    const cell = row[c];
    if (!cell || cell.t !== "s") continue;
    const text = cellText(cell);
    if (/^\p{L}/u.test(text)) return text;
  }
  return null;
}

/** Normalized texts of a row's non-empty cells, keyed by column. */
function rowNorms(row: RawCell[] | undefined): Map<number, string> {
  const out = new Map<number, string>();
  for (const c of nonEmptyCols(row)) out.set(c, normalizeHeader(cellText(row![c])));
  return out;
}

/**
 * A repeated header matches >= 80 % of the header cells. Bails out as soon as
 * too many cells differ, so ordinary data rows cost one or two comparisons.
 */
function repeatsRow(row: RawCell[], ref: Map<number, string>): boolean {
  if (ref.size === 0) return false;
  const needed = ref.size === 1 ? 1 : Math.max(2, Math.ceil(ref.size * 0.8));
  const allowedMisses = ref.size - needed;
  let misses = 0;
  for (const [c, norm] of ref) {
    const same = norm !== "" && normalizeHeader(cellText(row[c])) === norm;
    if (!same && ++misses > allowedMisses) return false;
  }
  return true;
}

/** Sum rows and footer lines: they neither confirm nor contradict a header above them. */
function isNoiseRow(row: RawCell[], cols: number[]): boolean {
  const first = firstText(row, cols);
  return first !== null && (isSumLabel(first) || FOOTER_RE.test(first) || PAGE_RE.test(first));
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.filter((x) => x !== ""));
  const B = new Set(b.filter((x) => x !== ""));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---- Header scoring ---------------------------------------------------------

interface Candidate {
  row: number;
  score: number;
}

function scoreHeaderRow(grid: RawCell[][], r: number): number {
  const row = grid[r] ?? [];
  const cols = nonEmptyCols(row);
  if (cols.length === 0) return 0;

  const classes = cols.map((c) => classifyCell(row[c]));
  const textRatio = classes.filter((k) => k === "text").length / cols.length;
  const uniq = new Set(cols.map((c) => normalizeHeader(cellText(row[c])))).size / cols.length;

  const headerSet = new Set(cols);
  const norms = rowNorms(row);
  let maxCols = cols.length;
  let belowSum = 0;
  let belowCount = 0;
  for (let i = r + 1; i < grid.length && belowCount < LOOKAHEAD_ROWS; i++) {
    const below = grid[i] ?? [];
    const bc = nonEmptyCols(below);
    if (bc.length === 0) continue;
    // Paged exports repeat the header and print page footers between the pages.
    if (repeatsRow(below, norms) || isNoiseRow(below, bc)) continue;
    belowCount++;
    maxCols = Math.max(maxCols, bc.length);
    const hasData = bc.some((c) => {
      const k: CellClass = classifyCell(below[c]);
      return k === "number" || k === "date";
    });
    const aligned = bc.filter((c) => headerSet.has(c)).length / bc.length;
    belowSum += 0.5 * (hasData ? 1 : 0) + 0.5 * aligned;
  }
  const below = belowCount === 0 ? 0 : belowSum / belowCount;
  const fill = cols.length / maxCols;

  // Type contrast: a header's text sits directly above numbers/dates.
  let contrast = 0;
  cols.forEach((c, i) => {
    if (classes[i] !== "text") return;
    for (let k = r + 1; k < grid.length && k <= r + 2 * LOOKAHEAD_ROWS; k++) {
      const cell = grid[k]?.[c];
      if (cellText(cell) === "") continue;
      const kind = classifyCell(cell);
      if (kind === "number" || kind === "date") contrast++;
      break;
    }
  });
  contrast /= cols.length;

  let score = 0.25 * textRatio + 0.1 * uniq + 0.15 * fill + 0.3 * below + 0.2 * contrast;
  // A header has text; a lone cell in a wider sheet is a title, not a header.
  if (textRatio === 0) score *= 0.3;
  if (cols.length === 1 && maxCols > 1) score *= 0.3;
  const first = firstText(row, cols);
  if (first && (isSumLabel(first) || FOOTER_RE.test(first))) score *= 0.2;
  return score;
}

// ---- Group header -------------------------------------------------------------

function isGroupRow(sheet: RawSheet, grid: RawCell[][], g: number, headerCols: number[]): boolean {
  if (g < 0 || headerCols.length === 0) return false;
  const raw = sheet.rows[g] ?? [];
  const rawCols = nonEmptyCols(raw);
  if (rawCols.length === 0) return false;
  if (!rawCols.every((c) => classifyCell(raw[c]) === "text")) return false;

  const minC = headerCols[0]!;
  const maxC = headerCols[headerCols.length - 1]!;
  const filledCols = nonEmptyCols(grid[g]);
  if (!filledCols.every((c) => c >= minC && c <= maxC)) return false;

  const rowMerges = sheet.merges.filter((m) => m.s.r <= g && m.e.r >= g && m.e.c > m.s.c);
  // A merge across the whole table width is a title.
  const titleLike = rowMerges.some((m) => m.s.c <= minC && m.e.c >= maxC);
  if (titleLike) return false;
  if (rowMerges.length > 0) return true;
  // Unmerged group labels span several columns, so they never sit side by side;
  // "Bolag: | MBAB" directly above the header is a meta line, not a group row.
  // They group measures, so the first (row label) column stays empty: text
  // there ("Timrapport | | MBAB") is a title line.
  const adjacent = rawCols.some((c, i) => i > 0 && rawCols[i - 1] === c - 1);
  const labelled = rawCols.some((c) => cellText(raw[c]).endsWith(":"));
  return (
    rawCols.length >= 2 &&
    rawCols.length < headerCols.length &&
    rawCols.every((c) => c > minC) &&
    !adjacent &&
    !labelled
  );
}

// ---- Sum rows by their numbers -------------------------------------------------

interface PendingRow {
  r: number;
  /** Non-empty cells in the row. */
  width: number;
  reason?: SkippedRow["reason"];
  detail?: string;
  /** Looks like a footer line; confirmed once the table's shape is known. */
  footer?: string;
}

/** Equal within the rounding of the shown values (stored numbers: float noise only). */
function closeTo(a: number, b: number, decimals: number, terms: number): boolean {
  const rounding = decimals > 0 ? 0.5 * 10 ** -decimals * (terms + 1) : 0;
  return Math.abs(a - b) <= rounding + 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function findLast<T>(list: T[], before: number, test: (x: T) => boolean): number {
  for (let i = Math.min(before, list.length) - 1; i >= 0; i--) if (test(list[i]!)) return i;
  return -1;
}

/**
 * Sum rows without a plain sum word: a "Total MBAB" subtotal, or an unlabeled
 * grand total under the last data row. Such a row only counts as a sum row
 * when every number in it equals the column sums of at least two data rows
 * above it (since the previous sum row, or all of them) and it carries nothing
 * else, so a customer named "Total Bygg AB" or an ordinary last row is kept.
 */
function markComputedSumRows(grid: RawCell[][], pending: PendingRow[]): void {
  const cache = new Map<number, Map<number, number | null>>();
  const num = (r: number, c: number): number | null => {
    let row = cache.get(r);
    if (!row) cache.set(r, (row = new Map()));
    if (!row.has(c)) row.set(c, cellNumber(grid[r]?.[c]));
    return row.get(c)!;
  };
  const isData = (p: PendingRow) => !p.reason;

  /** Each listed cell of row i equals its column's sum over the data rows in [from, i). */
  const equalsSum = (i: number, from: number, cols: number[]): boolean => {
    const r = pending[i]!.r;
    const rows: number[] = [];
    for (let k = from; k < i; k++) if (isData(pending[k]!)) rows.push(pending[k]!.r);
    if (rows.length < 2) return false;
    // Column by column, so an ordinary row is usually rejected after one column.
    return cols.every((c) => {
      let sum = 0;
      for (const rr of rows) sum += num(rr, c) ?? 0;
      const shown = num(r, c)!;
      if (closeTo(sum, shown, 0, rows.length)) return true;
      let decimals = shownDecimals(grid[r]?.[c]);
      for (const rr of rows) decimals = Math.max(decimals, shownDecimals(grid[rr]?.[c]));
      return closeTo(sum, shown, decimals, rows.length);
    });
  };
  const segmentStart = (i: number) => findLast(pending, i, (p) => p.reason === "sum_row") + 1;
  /** The sum of its segment, or (for the last data row) of all data rows. */
  const equalsAnySum = (i: number, cols: number[], isLast: boolean): boolean => {
    const from = segmentStart(i);
    return equalsSum(i, from, cols) || (isLast && from > 0 && equalsSum(i, 0, cols));
  };
  const last = findLast(pending, pending.length, isData);

  // "Total …" / "Sum …" rows: the label plus numbers only.
  let checks = 0;
  pending.forEach((p, i) => {
    if (!isData(p) || checks >= MAX_SUM_CHECKS) return;
    const row = grid[p.r] ?? [];
    const cols = nonEmptyCols(row);
    const first = firstText(row, cols);
    if (first === null || !SUM_WORD.test(first)) return;
    const numeric = cols.filter((c) => num(p.r, c) !== null);
    if (numeric.length === 0 || numeric.length < cols.length - 1) return;
    checks++;
    if (equalsAnySum(i, numeric, i === last)) {
      p.reason = "sum_row";
      p.detail = first;
    }
  });

  // An unlabeled last row: numbers only, empty where the data rows have labels.
  if (last < 0 || pending[last]!.reason) return;
  const r = pending[last]!.r;
  const row = grid[r] ?? [];
  const cols = nonEmptyCols(row);
  if (cols.length === 0 || !cols.every((c) => num(r, c) !== null)) return;
  const labelCols = new Set<number>();
  for (let k = last - 1, seen = 0; k >= 0 && seen < LOOKAHEAD_ROWS * 2; k--) {
    const p = pending[k]!;
    if (!isData(p)) continue;
    seen++;
    for (const c of nonEmptyCols(grid[p.r])) {
      const cell = grid[p.r]![c];
      const kind = classifyCell(cell);
      if (kind === "date" || (kind === "text" && /^\p{L}/u.test(cellText(cell)))) labelCols.add(c);
    }
  }
  if (labelCols.size === 0 || cols.some((c) => labelCols.has(c))) return;
  if (equalsAnySum(last, cols, true)) {
    pending[last]!.reason = "sum_row";
    pending[last]!.detail = SUM_OF_ROWS_DETAIL;
  }
}

// ---- Table building -----------------------------------------------------------

function buildTable(
  sheet: RawSheet,
  grid: RawCell[][],
  headerRow: number,
  confidence: number,
): DetectedTable {
  const headerCols = nonEmptyCols(grid[headerRow]);
  const group = isGroupRow(sheet, grid, headerRow - 1, headerCols);
  const headerRows = group ? [headerRow - 1, headerRow] : [headerRow];
  const firstHeader = headerRows[0]!;

  const headerTexts = (c: number): string => {
    const parts: string[] = [];
    for (const r of headerRows) {
      const t = cellText(grid[r]?.[c]);
      if (t !== "" && !parts.includes(t)) parts.push(t);
    }
    return parts.join(" ");
  };

  // Rows below the header, classified.
  const headerNorm = rowNorms(grid[headerRow]);
  const groupNorm = group ? rowNorms(grid[headerRow - 1]) : new Map<number, string>();

  const pending: PendingRow[] = [];
  const dataCols = new Set<number>(headerCols);
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const cols = nonEmptyCols(row);
    if (cols.length === 0) {
      pending.push({ r, width: 0, reason: "empty" });
      continue;
    }
    if (repeatsRow(row, headerNorm) || (group && repeatsRow(row, groupNorm))) {
      pending.push({ r, width: cols.length, reason: "repeated_header" });
      continue;
    }
    const first = firstText(row, cols);
    if (first && FOOTER_RE.test(first) && cols.length <= 3) {
      pending.push({ r, width: cols.length, footer: first });
      continue;
    }
    if (first && isSumLabel(first)) {
      pending.push({ r, width: cols.length, reason: "sum_row", detail: first });
      continue;
    }
    pending.push({ r, width: cols.length });
  }

  const isData = (p: PendingRow) => !p.reason && p.footer === undefined;
  const widths = pending
    .filter(isData)
    .map((p) => p.width)
    .sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)]! : 0;

  // Footer words ("Utskriven", "Skapad") are also ordinary values. Inside the
  // table a footer must be narrower than the data rows or carry a page marker;
  // after the last data row any footer-like line is a footer.
  let lastData = -1;
  pending.forEach((p, i) => {
    if (isData(p)) lastData = i;
  });
  pending.forEach((p, i) => {
    if (p.footer === undefined) return;
    const rowText = nonEmptyCols(grid[p.r])
      .map((c) => cellText(grid[p.r]![c]))
      .join(" ");
    if (i > lastData || p.width < median || PAGE_RE.test(rowText)) {
      p.reason = "footer";
      p.detail = p.footer;
    }
    delete p.footer;
  });

  // Trailing footer block: lone text lines after the last data row.
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i]!;
    if (p.reason === "empty" || p.reason === "footer") continue;
    if (p.reason) break;
    const row = grid[p.r] ?? [];
    const cols = nonEmptyCols(row);
    const lone = cols.length === 1 && classifyCell(row[cols[0]!]) === "text" && median >= 3;
    if (!lone) break;
    p.reason = "footer";
    p.detail = cellText(row[cols[0]!]);
  }

  markComputedSumRows(grid, pending);

  for (const p of pending) {
    if (p.reason) continue;
    for (const c of nonEmptyCols(grid[p.r])) dataCols.add(c);
  }
  const columnsIdx = [...dataCols].sort((a, b) => a - b);
  const columns: DetectedColumn[] = columnsIdx.map((index) => {
    const header = headerTexts(index) || `Kolumn ${columnLetter(index)}`;
    return { index, header, normalized: normalizeHeader(header) };
  });

  const rows: DetectedRow[] = [];
  const skipped: SkippedRow[] = [];
  for (const p of pending) {
    if (p.reason) {
      const s: SkippedRow = { sourceRow: p.r + 1, reason: p.reason };
      if (p.detail) s.detail = p.detail;
      skipped.push(s);
      continue;
    }
    const row = grid[p.r] ?? [];
    rows.push({ sourceRow: p.r + 1, cells: columnsIdx.map((c) => row[c] ?? EMPTY_CELL) });
  }

  const metaLines: string[] = [];
  for (let r = 0; r < firstHeader; r++) {
    const raw = sheet.rows[r] ?? [];
    const texts = nonEmptyCols(raw).map((c) => cellText(raw[c]));
    if (texts.length > 0) metaLines.push(texts.join(" "));
  }

  return {
    sheetName: sheet.name,
    headerRows,
    columns,
    rows,
    skipped,
    metaLines,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
  };
}

function emptyTable(sheet: RawSheet): DetectedTable {
  return {
    sheetName: sheet.name,
    headerRows: [],
    columns: [],
    rows: [],
    skipped: [],
    metaLines: [],
    confidence: 0,
  };
}

/** Headers a candidate row would produce (incl. a group row), normalized. */
function candidateHeaders(sheet: RawSheet, grid: RawCell[][], r: number): string[] {
  const cols = nonEmptyCols(grid[r]);
  const group = isGroupRow(sheet, grid, r - 1, cols);
  return cols.map((c) => {
    const parts: string[] = [];
    for (const row of group ? [r - 1, r] : [r]) {
      const t = cellText(grid[row]?.[c]);
      if (t !== "" && !parts.includes(t)) parts.push(t);
    }
    return normalizeHeader(parts.join(" "));
  });
}

/**
 * Detect the table in a sheet. Header candidates in the first rows are scored
 * on text share, uniqueness, width, type contrast (text above numbers/dates)
 * and whether the rows below look like data. confidence < 0.5 means the UI
 * should let the user pick the header row. Each DetectedRow's cells are aligned
 * with `columns` (cells[i] belongs to columns[i]).
 */
export function detectTable(sheet: RawSheet, opts: DetectOptions = {}): DetectedTable {
  const grid = fillMergedText(sheet);
  const scan = Math.min(grid.length, opts.maxScanRows ?? DEFAULT_SCAN_ROWS);
  const candidates: Candidate[] = [];
  for (let r = 0; r < scan; r++) {
    const score = scoreHeaderRow(grid, r);
    if (score > 0) candidates.push({ row: r, score });
  }
  if (candidates.length === 0) return emptyTable(sheet);

  if (opts.expectedHeaders && opts.expectedHeaders.length > 0) {
    const expected = opts.expectedHeaders;
    const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, 5);
    for (const c of top) c.score += 0.5 * jaccard(candidateHeaders(sheet, grid, c.row), expected);
  }

  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.row - b.row);
  const best = ranked[0]!;
  // A repeat of the best row (paged exports) is the same header, not a rival.
  const bestNorms = [...rowNorms(grid[best.row]).values()].join("\u0000");
  const second = ranked
    .slice(1)
    .find((c) => [...rowNorms(grid[c.row]).values()].join("\u0000") !== bestNorms);
  const margin = second ? best.score - second.score : 1;
  const confidence = Math.min(1, best.score) * (0.75 + 0.25 * Math.min(1, margin / 0.2));
  return buildTable(sheet, grid, best.row, confidence);
}

/** Build the table with a header row chosen by the user (0-based). Confidence is 1. */
export function detectTableWithHeaderRow(sheet: RawSheet, rowIndex: number): DetectedTable {
  const grid = fillMergedText(sheet);
  if (rowIndex < 0 || rowIndex >= grid.length || nonEmptyCols(grid[rowIndex]).length === 0) {
    return emptyTable(sheet);
  }
  return buildTable(sheet, grid, rowIndex, 1);
}

function hasContent(sheet: RawSheet): boolean {
  return sheet.rows.some((row) => row.some((c) => cellText(c) !== ""));
}

/**
 * Choose the sheet to import: the hinted one (exact name, then case-insensitive,
 * then a close match), else the first visible non-empty sheet.
 */
export function pickSheet(workbook: RawWorkbook, hint?: string): RawSheet | null {
  const sheets = workbook.sheets;
  if (sheets.length === 0) return null;
  if (hint) {
    const exact = sheets.find((s) => s.name === hint);
    if (exact) return exact;
    const norm = normalizeHeader(hint);
    const loose = sheets.find((s) => normalizeHeader(s.name) === norm);
    if (loose) return loose;
    const close = sheets
      .map((s) => ({ s, sim: similarity(normalizeHeader(s.name), norm) }))
      .filter((x) => x.sim >= 0.8)
      .sort((a, b) => b.sim - a.sim)[0];
    if (close) return close.s;
  }
  return (
    sheets.find((s) => !s.hidden && hasContent(s)) ??
    sheets.find((s) => hasContent(s)) ??
    sheets[0] ??
    null
  );
}
