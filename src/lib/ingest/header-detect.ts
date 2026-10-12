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
import { EMPTY_CELL, cellText, classifyCell, columnLetter, type CellClass } from "./cells";

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
  let maxCols = cols.length;
  let belowSum = 0;
  let belowCount = 0;
  for (let i = r + 1; i < grid.length && belowCount < LOOKAHEAD_ROWS; i++) {
    const below = grid[i] ?? [];
    const bc = nonEmptyCols(below);
    if (bc.length === 0) continue;
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
  const adjacent = rawCols.some((c, i) => i > 0 && rawCols[i - 1] === c - 1);
  const labelled = rawCols.some((c) => cellText(raw[c]).endsWith(":"));
  return (
    rawCols.length >= 2 &&
    rawCols.length < headerCols.length &&
    rawCols.some((c) => c > minC) &&
    !adjacent &&
    !labelled
  );
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
  const headerNorm = new Map<number, string>();
  for (const c of headerCols) headerNorm.set(c, normalizeHeader(cellText(grid[headerRow]?.[c])));
  const groupNorm = new Map<number, string>();
  if (group) {
    for (const c of nonEmptyCols(grid[headerRow - 1])) {
      groupNorm.set(c, normalizeHeader(cellText(grid[headerRow - 1]?.[c])));
    }
  }

  // A repeated header matches >= 80 % of the header cells. Bail out as soon as
  // too many cells differ, so ordinary data rows cost one or two comparisons.
  const repeats = (row: RawCell[], ref: Map<number, string>): boolean => {
    if (ref.size === 0) return false;
    const needed = ref.size === 1 ? 1 : Math.max(2, Math.ceil(ref.size * 0.8));
    const allowedMisses = ref.size - needed;
    let misses = 0;
    for (const [c, norm] of ref) {
      const same = norm !== "" && normalizeHeader(cellText(row[c])) === norm;
      if (!same && ++misses > allowedMisses) return false;
    }
    return true;
  };

  type Pending = { r: number; reason?: SkippedRow["reason"]; detail?: string };
  const pending: Pending[] = [];
  const dataCols = new Set<number>(headerCols);
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const cols = nonEmptyCols(row);
    if (cols.length === 0) {
      pending.push({ r, reason: "empty" });
      continue;
    }
    if (repeats(row, headerNorm) || (group && repeats(row, groupNorm))) {
      pending.push({ r, reason: "repeated_header" });
      continue;
    }
    const first = firstText(row, cols);
    if (first && FOOTER_RE.test(first) && cols.length <= 3) {
      pending.push({ r, reason: "footer", detail: first });
      continue;
    }
    if (first && isSumLabel(first)) {
      pending.push({ r, reason: "sum_row", detail: first });
      continue;
    }
    pending.push({ r });
  }

  // Trailing footer block: lone text lines after the last data row.
  const dataCounts = pending
    .filter((p) => !p.reason)
    .map((p) => nonEmptyCols(grid[p.r]).length)
    .sort((a, b) => a - b);
  const median = dataCounts.length ? dataCounts[Math.floor(dataCounts.length / 2)]! : 0;
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
  const second = ranked[1];
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
