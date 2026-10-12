// Generates the synthetic, deliberately messy import files in fixtures/files/ and their
// ground truth in fixtures/truth/. Every name and number is fictional and every random
// choice comes from a seeded PRNG, so a re-run reproduces identical bytes.
//
// The truth is computed from the generator's own model of what each row MEANS (which
// shifts are real, which customer a spelling variant belongs to, when a case ended), never
// by parsing the written files and never with src/lib/ingest or src/lib/sie. That keeps it
// an independent oracle for the app. fixtures/README.md documents the intended mapping of
// every file; fixtures/truth/manifest.json carries the same mapping as import templates.
//
// Run:  pnpm fixtures
//       node --experimental-strip-types scripts/fixtures/generate.ts [--out <dir>]
// --out writes <dir>/files and <dir>/truth instead of fixtures/ (used by the freshness test).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as prettier from "prettier";
import * as XLSX from "xlsx";

type MonthApi = typeof import("../../src/lib/core/month");
type FormatApi = typeof import("../../src/lib/core/format-sv");

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

// Loaded at runtime by explicit .ts path: Node's type stripping needs the extension, which
// the shared tsconfig does not allow in static imports. Types still come from the modules.
const { dateToMonth, daysInMonth, monthEndDate, monthRange, MONTH_ABBR_SV } = (await import(
  pathToFileURL(join(ROOT, "src/lib/core/month.ts")).href
)) as MonthApi;
const { formatNumber, NBSP } = (await import(
  pathToFileURL(join(ROOT, "src/lib/core/format-sv.ts")).href
)) as FormatApi;

// ---------------------------------------------------------------------------
// Random numbers, dates and small formatting helpers
// ---------------------------------------------------------------------------

const SEED_PREFIX = "mb-stats-fixtures-v1";

function hashSeed(label: string): number {
  let h = 2166136261;
  for (const ch of label) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32. One independent stream per dataset so editing one file never reshuffles another. */
class Rng {
  private state: number;

  constructor(label: string) {
    this.state = hashSeed(`${SEED_PREFIX}:${label}`);
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    const last = items[items.length - 1];
    if (!last) throw new Error("weighted pick from an empty list");
    return last[0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Amount in kronor with öre. */
  amount(min: number, max: number): number {
    return round2(min + this.next() * (max - min));
  }
}

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, "0");
const round2 = (x: number) => Math.round(x * 100) / 100;
const minIso = (a: string, b: string) => (a < b ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);

function utc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function isoFromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(iso: string, days: number): string {
  return isoFromUtc(utc(iso) + days * DAY_MS);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

function randomDate(rng: Rng, from: string, to: string): string {
  return addDays(from, rng.int(0, daysBetween(from, to)));
}

function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Excel 1900-system serial (days since 1899-12-30; exact for dates after 1900-03-01). */
function excelSerial(iso: string): number {
  return (utc(iso) - Date.UTC(1899, 11, 30)) / DAY_MS;
}

/** "2026-09-30" -> "30/9 2026", the free-text date style some Intelliplan rows carry. */
function dayMonthYear(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))} ${iso.slice(0, 4)}`;
}

function decimalsOf(x: number): number {
  if (Math.abs(x - Math.round(x)) < 1e-9) return 0;
  if (Math.abs(x * 10 - Math.round(x * 10)) < 1e-9) return 1;
  return 2;
}

/** Swedish number text with the fewest decimals needed: 8 -> "8", 7.5 -> "7,5". */
function svNumber(x: number): string {
  return formatNumber(x, decimalsOf(x));
}

/** "12 345,50 kr" with NBSP (as format-sv writes it) or a plain space as thousands separator. */
function svAmountText(x: number, plainSpace: boolean): string {
  const text = `${formatNumber(x, 2)} kr`;
  return plainSpace ? text.replaceAll(NBSP, " ") : text;
}

function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Normalized header as the contracts define it: lowercased, trimmed, collapsed whitespace. */
function normalizeHeader(h: string): string {
  return h.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Fictional people and personnummer
// ---------------------------------------------------------------------------

// prettier-ignore
const FIRST_NAMES = [
  "Anna", "Erik", "Fatima", "Mohammed", "Sara", "Johan", "Leila", "Ahmed", "Elin", "Oskar",
  "Amina", "Karl", "Noor", "Viktor", "Hanna", "Ali", "Maja", "Daniel", "Yasmin", "Emil",
  "Zainab", "Lucas", "Sofia", "Hassan", "Ida", "Filip", "Mariam", "Gustav", "Aisha", "Linnea",
  "Omar", "Ebba", "Jonas", "Rania", "Alva", "Samir", "Wilma", "Adam", "Lina", "Ibrahim",
  "Klara", "Jakob", "Nadia", "Axel", "Selma", "Yusuf", "Freja", "Hugo", "Dalia", "Elias",
  "Tilda", "Abdi", "Agnes", "Isak", "Hiba", "Ludvig", "Saga", "Kerim", "Vera", "Arvid",
];

// prettier-ignore
const LAST_NAMES = [
  "Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson",
  "Svensson", "Gustafsson", "Pettersson", "Jonsson", "Jansson", "Hansson", "Bengtsson",
  "Jönsson", "Lindberg", "Jakobsson", "Magnusson", "Lindström", "Ali", "Mohamed", "Hassan",
  "Ahmed", "Yilmaz", "Hussein", "Abdullahi", "Lindqvist", "Berg", "Axelsson", "Sandberg",
  "Forsberg", "Sjöberg", "Wallin", "Engström", "Eklund", "Danielsson", "Lundin", "Holm",
  "Bergström", "Nyström", "Öberg", "Åberg", "Ström", "Fransson", "Söderberg", "Kaya", "Demir",
  "Nordin", "Mattsson",
];

class NameGen {
  private readonly used = new Set<string>();
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  next(): { first: string; last: string } {
    for (;;) {
      const first = this.rng.pick(FIRST_NAMES);
      const last = this.rng.pick(LAST_NAMES);
      const key = `${first} ${last}`;
      if (!this.used.has(key)) {
        this.used.add(key);
        return { first, last };
      }
    }
  }
}

/** Luhn check digit over the nine digits YYMMDDNNN. */
function luhnDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Fake but checksum-valid personnummer ("long" = YYYYMMDD-NNNC, "short" = YYMMDD-NNNC).
 * The födelsenummer is drawn from 980-999, the series of Skatteverket's published test
 * personnummer that is never assigned to a real person; a random serial would land on a
 * real person's number for roughly every third fake.
 */
function fakePersonnummer(rng: Rng, style: "long" | "short"): string {
  const year = rng.int(1962, 2005);
  const month = rng.int(1, 12);
  const day = rng.int(1, daysInMonth(`${year}-${pad2(month)}`));
  const serial = String(rng.int(980, 999));
  const yymmdd = `${String(year).slice(2)}${pad2(month)}${pad2(day)}`;
  const check = luhnDigit(`${yymmdd}${serial}`);
  const body = `${serial}${check}`;
  return style === "long" ? `${year}${pad2(month)}${pad2(day)}-${body}` : `${yymmdd}-${body}`;
}

// ---------------------------------------------------------------------------
// Spreadsheet cells and sheet layout bookkeeping
// ---------------------------------------------------------------------------

type Cell =
  | { t: "s"; v: string }
  | { t: "n"; v: number; z?: string }
  | { t: "d"; v: string }
  | { t: "f"; v: number; f: string; z?: string }
  | null;

const DATE_FMT = "yyyy-mm-dd";
const AMOUNT_FMT = "#,##0.00";
const INT_FMT = "#,##0";

const str = (v: string): Cell => ({ t: "s", v });
const num = (v: number, z?: string): Cell => (z ? { t: "n", v, z } : { t: "n", v });
const dateCell = (iso: string): Cell => ({ t: "d", v: iso });
const formula = (f: string, v: number, z?: string): Cell =>
  z ? { t: "f", v, f, z } : { t: "f", v, f };

type RowRole = "meta" | "header" | "data" | "empty" | "sum" | "footer";

interface SheetLayout {
  sheet: string;
  /** 1-based row numbers as Excel shows them. */
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  /** Rows with role "data", including rows the intended mapping filters out. */
  dataRows: number;
  metaRows: number[];
  emptyRows: number[];
  sumRows: number[];
  footerRows: number[];
  merges: string[];
}

class SheetBuilder {
  readonly rows: Cell[][] = [];
  readonly roles: RowRole[] = [];
  readonly merges: XLSX.Range[] = [];
  readonly name: string;
  readonly widths: number[];

  constructor(name: string, widths: number[]) {
    this.name = name;
    this.widths = widths;
  }

  /** Appends a row and returns its 1-based row number. */
  add(role: RowRole, cells: Cell[] = []): number {
    this.rows.push(cells);
    this.roles.push(role);
    return this.rows.length;
  }

  merge(row: number, fromCol: number, toCol: number): void {
    this.merges.push({ s: { r: row - 1, c: fromCol }, e: { r: row - 1, c: toCol } });
  }

  layout(): SheetLayout {
    const rowsWith = (role: RowRole) => this.roles.flatMap((r, i) => (r === role ? [i + 1] : []));
    const data = rowsWith("data");
    const header = rowsWith("header")[0];
    if (header === undefined || data.length === 0) throw new Error(`${this.name}: no header/data`);
    return {
      sheet: this.name,
      headerRow: header,
      firstDataRow: data[0] ?? 0,
      lastDataRow: data[data.length - 1] ?? 0,
      dataRows: data.length,
      metaRows: rowsWith("meta"),
      emptyRows: rowsWith("empty"),
      sumRows: rowsWith("sum"),
      footerRows: rowsWith("footer"),
      merges: this.merges.map((m) => XLSX.utils.encode_range(m)),
    };
  }

  toWorksheet(): XLSX.WorkSheet {
    const ws: XLSX.WorkSheet = {};
    this.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const ref = XLSX.utils.encode_cell({ r, c });
        switch (cell.t) {
          case "s":
            ws[ref] = { t: "s", v: cell.v };
            break;
          case "n":
            ws[ref] = cell.z ? { t: "n", v: cell.v, z: cell.z } : { t: "n", v: cell.v };
            break;
          case "d":
            ws[ref] = { t: "n", v: excelSerial(cell.v), z: DATE_FMT };
            break;
          case "f":
            ws[ref] = cell.z
              ? { t: "n", v: cell.v, f: cell.f, z: cell.z }
              : { t: "n", v: cell.v, f: cell.f };
            break;
        }
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: this.rows.length - 1, c: this.widths.length - 1 },
    });
    if (this.merges.length > 0) ws["!merges"] = this.merges;
    ws["!cols"] = this.widths.map((wch) => ({ wch }));
    return ws;
  }
}

function writeXlsx(sheets: SheetBuilder[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(wb, sheet.toWorksheet(), sheet.name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const CP1252_EXTRA: Record<string, number> = {
  "€": 0x80,
  "–": 0x96,
  "—": 0x97,
  "’": 0x92,
  "”": 0x94,
};

/** Windows-1252 encoder for the characters the fixtures use (Latin-1 plus a few extras). */
function encodeCp1252(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else {
      const byte = CP1252_EXTRA[ch];
      if (byte === undefined) throw new Error(`Not encodable in windows-1252: ${ch}`);
      out.push(byte);
    }
  }
  return Buffer.from(out);
}

function encodeUtf16LeWithBom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

// ---------------------------------------------------------------------------
// Ground truth facts
// ---------------------------------------------------------------------------

type Company = "MBAB" | "MBR";

const COMPANY_INFO: Record<Company, { legalName: string; orgNr: string; shortName: string }> = {
  MBAB: { legalName: "Miljonbemanning AB", orgNr: "556959-9318", shortName: "MB AB" },
  MBR: { legalName: "Miljonbemanning Restart AB", orgNr: "559208-9071", shortName: "MB Restart" },
};

interface Fact {
  metricKey: string;
  company: Company;
  month: string;
  dims: Record<string, string>;
  value: number;
}

function sortedDims(dims: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(dims).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function round6(x: number): number {
  const r = Math.round(x * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

class FactSet {
  private readonly byKey = new Map<string, Fact>();

  private key(metricKey: string, company: Company, month: string, dims: Record<string, string>) {
    return JSON.stringify([metricKey, company, month, dims]);
  }

  add(
    metricKey: string,
    company: Company,
    month: string,
    dims: Record<string, string>,
    value: number,
  ): void {
    const d = sortedDims(dims);
    const key = this.key(metricKey, company, month, d);
    const existing = this.byKey.get(key);
    if (existing) existing.value += value;
    else this.byKey.set(key, { metricKey, company, month, dims: d, value });
  }

  /** Rounded to 6 decimals, value-0 facts dropped (except metrics in keepZero), canonical order. */
  list(keepZero: ReadonlySet<string> = new Set()): Fact[] {
    return [...this.byKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, f]) => ({ ...f, value: round6(f.value) }))
      .filter((f) => f.value !== 0 || keepZero.has(f.metricKey));
  }
}

// ---------------------------------------------------------------------------
// Manifest (machine-readable mapping for integration tests)
// ---------------------------------------------------------------------------

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface TextLayout {
  headerLine: number;
  dataLines: number;
  lineEnding: "CRLF" | "LF";
}

interface ManifestEntry {
  file: string;
  truth: string;
  format: "xlsx" | "csv" | "xls-html";
  datasetKey: string | null;
  kind: "table" | "cases" | "reference";
  description: string;
  companies: Company[];
  scenario: "utfall" | "budget";
  /** Months present in the truth file. */
  months: string[];
  /** Upload choices that reproduce the truth (month/company/asOfDate). */
  choices: { month?: string; company?: Company; asOfDate?: string };
  encoding?: string;
  delimiter?: string;
  /** Export/print date written inside the file, if any. */
  exportDate?: string;
  layout: SheetLayout[] | TextLayout;
  /** dimension -> raw spelling -> canonical label, for testing the `lookup` step. */
  aliases: Record<string, Record<string, string>>;
  /** ImportTemplate JSON objects (src/lib/contracts/pipeline.ts) reproducing the truth. */
  templates: Json[];
  /** Truth is identical to this file's truth (same data, different shape). */
  sameTruthAs?: string;
  drift?: {
    fromTemplateOf: string;
    added: string[];
    removed: string[];
    /** The rename a person sees; a similarity-based detector may report it only as removed + added. */
    renamed: { from: string; to: string }[];
    /** Must be false: the v1 template cannot be applied as-is. */
    compatible: boolean;
  };
  /** scripts/reconcile/configs/<name> used by `reconcile.py --selftest`. */
  reconcileConfig: string;
  /** Row counts by meaning (e.g. rows the mapping must filter out, and why). */
  counts: Record<string, number>;
}

interface Output {
  file: string;
  bytes: Buffer;
  truth: Fact[];
  entry: ManifestEntry;
}

function monthsOf(facts: Fact[]): string[] {
  return [...new Set(facts.map((f) => f.month))].sort();
}

type Col = { [key: string]: Json };

function mapCol(
  column: string,
  type: string,
  usage: string,
  extra: { metricKey?: string; dimensionKey?: string; personal?: boolean } = {},
): Col {
  const out: Col = { column, type, usage };
  if (extra.metricKey) out.metricKey = extra.metricKey;
  if (extra.dimensionKey) out.dimensionKey = extra.dimensionKey;
  if (extra.personal) {
    out.personal = true;
    out.keep = false;
  }
  return out;
}

function template(
  datasetKey: string,
  name: string,
  headers: string[],
  config: Col,
  sheetHint?: string,
): Json {
  const out: Col = {
    datasetKey,
    name,
    headerSignature: headers.map(normalizeHeader),
    version: 1,
    config,
  };
  if (sheetHint) out.sheetHint = sheetHint;
  return out;
}

/** Replace step mapping the second PostNord spelling to the canonical customer. */
const POSTNORD_REPLACE: Col = {
  op: "replace",
  column: "kund",
  find: "Postnord",
  replace: "PostNord AB",
  match: "whole_cell",
  caseSensitive: false,
};
const KUND_ALIASES = { kund: { Postnord: "PostNord AB" } };

// ---------------------------------------------------------------------------
// The shared world: customers, assignments and consultants (Intelliplan, MBAB)
// ---------------------------------------------------------------------------

const PRESENTATION_KUND = "Miljonbemanning Presentation (Stockholm)";
const UNSTAFFED_NAME = "Okänd arbetstagare";
const BEMANNING = "Bemanning";

interface Assignment {
  /** Customer name as the Intelliplan customer record spells it. */
  kundDisplay: string;
  /** Canonical customer label (after the intended alias mapping). */
  kund: string;
  uppdrag: string;
  avdelning: string;
  weight: number;
  /** Billing rate kr/h. */
  rate: number;
  hours: number[];
}

const DAY_HOURS = [6, 7.5, 8, 8, 8, 8, 8.5, 4];
const NIGHT_HOURS = [7.5, 8.25, 8.25, 9, 10, 8];
const OFFICE_HOURS = [8, 8, 7.5, 4, 6];

// prettier-ignore
const ASSIGNMENTS: Assignment[] = [
  { kundDisplay: "Budbee Södertälje", kund: "Budbee Södertälje", uppdrag: "5101 - Terminalarbetare dag", avdelning: "Terminal", weight: 13, rate: 312, hours: DAY_HOURS },
  { kundDisplay: "Budbee Södertälje", kund: "Budbee Södertälje", uppdrag: "5102 - Terminalarbetare natt", avdelning: "Terminal", weight: 10, rate: 348, hours: NIGHT_HOURS },
  { kundDisplay: "Budbee Kungsängen", kund: "Budbee Kungsängen", uppdrag: "5201 - Sortering kväll", avdelning: "Sortering", weight: 14, rate: 318, hours: NIGHT_HOURS },
  { kundDisplay: "Early Bird AB", kund: "Early Bird AB", uppdrag: "5301 - Tidningsbud natt", avdelning: "Distribution", weight: 7, rate: 296, hours: NIGHT_HOURS },
  { kundDisplay: "Early Bird AB", kund: "Early Bird AB", uppdrag: "5302 - Packning", avdelning: "Lager", weight: 5, rate: 289, hours: DAY_HOURS },
  { kundDisplay: "PRV", kund: "PRV", uppdrag: "5401 - Administratör", avdelning: "Kontor", weight: 5, rate: 365, hours: OFFICE_HOURS },
  { kundDisplay: "Bosch", kund: "Bosch", uppdrag: "5501 - Montering", avdelning: "Produktion", weight: 7, rate: 329, hours: DAY_HOURS },
  { kundDisplay: "Bosch", kund: "Bosch", uppdrag: "5502 - Lagerarbetare", avdelning: "Lager", weight: 5, rate: 305, hours: DAY_HOURS },
  { kundDisplay: "Premo", kund: "Premo", uppdrag: "5601 - Truckförare", avdelning: "Lager", weight: 8, rate: 334, hours: DAY_HOURS },
  { kundDisplay: "PostNord AB", kund: "PostNord AB", uppdrag: "5701 - Paketsortering", avdelning: "Terminal", weight: 14, rate: 315, hours: NIGHT_HOURS },
  { kundDisplay: "Postnord", kund: "PostNord AB", uppdrag: "5702 - Brevsortering helg", avdelning: "Sortering", weight: 9, rate: 338, hours: DAY_HOURS },
];

const PRESENTATION: Assignment = {
  kundDisplay: PRESENTATION_KUND,
  kund: PRESENTATION_KUND,
  uppdrag: "5901 - Demopass",
  avdelning: "Demo",
  weight: 0,
  rate: 300,
  hours: [1.5, 2, 3, 4],
};

interface Person {
  id: number;
  first: string;
  last: string;
  pnr: string;
  form: string;
  ort: string;
  /** Hourly wage (kr), used for the fakturering file. */
  wage: number;
}

interface Employment {
  person: Person;
  start: string;
  end: string | null;
}

const KONSULT_TRUTH_END = "2026-09-30";
const KONSULT_EXPORT = "2026-10-01";

/** Demo "consultants" used on the presentation customer (filtered out by the mapping). */
const DEMO_PEOPLE: Person[] = [
  { id: 9001, first: "Demo", last: "Demosson", pnr: "", form: "", ort: "Stockholm", wage: 150 },
  { id: 9002, first: "Test", last: "Testsson", pnr: "", form: "", ort: "Stockholm", wage: 150 },
];

const fullName = (p: Person) => `${p.first} ${p.last}`;

function generateConsultants(): Employment[] {
  const rng = new Rng("konsulter");
  const names = new NameGen(rng);
  const plan: [count: number, from: string, to: string][] = [
    [25, "2023-01-09", "2023-12-28"],
    [34, "2024-01-08", "2024-12-20"],
    [44, "2025-01-07", "2025-12-19"],
    [42, "2026-01-05", "2026-09-25"],
  ];
  const starts: string[] = [];
  for (const [count, from, to] of plan) {
    const year = Array.from({ length: count }, () => randomDate(rng, from, to)).sort();
    starts.push(...year);
  }
  starts[0] = "2023-01-09"; // the file's earliest start is the first day of the produced range

  const employments: Employment[] = [];
  let id = 2001;
  starts.forEach((start, i) => {
    if (i > 0) id += 1 + (rng.chance(0.15) ? rng.int(1, 3) : 0);
    const { first, last } = names.next();
    const person: Person = {
      id,
      first,
      last,
      pnr: fakePersonnummer(rng, "long"),
      form: rng.weighted([
        ["Särskild visstidsanställning", 50],
        ["Tillsvidareanställning", 25],
        ["Behovsanställning", 20],
        ["Provanställning", 5],
      ] as const),
      ort: rng.weighted([
        ["Södertälje", 35],
        ["Stockholm", 30],
        ["Kungsängen", 20],
        ["Uppsala", 15],
      ] as const),
      wage: 140 + rng.int(0, 60) * 0.5,
    };
    employments.push({ person, start, end: endAfter(rng, start) });
  });

  // Boundary cases the truth rules must handle: ending on a month's last day (active at that
  // month end AND ended in that month) and starting on a month's last day.
  const ended = employments.filter((e) => e.end !== null && e.end < "2026-08-01");
  for (const e of [ended[3], ended[11]]) {
    if (e?.end) e.end = monthEndDate(dateToMonth(e.end));
  }
  const lateStarter = employments.find((e) => e.start >= "2026-03-01" && e.start <= "2026-03-31");
  if (lateStarter) {
    lateStarter.start = "2026-03-31";
    if (lateStarter.end !== null && lateStarter.end < lateStarter.start) lateStarter.end = null;
  }

  // Five rehires: same anställnings-id, a second employment after the first ended.
  const candidates = employments.filter((e) => e.end !== null && e.end <= "2026-03-31");
  for (const first of rng.shuffle(candidates).slice(0, 5)) {
    const start = addDays(first.end as string, rng.int(30, 200));
    if (start > "2026-09-25") continue;
    employments.push({ person: first.person, start, end: endAfter(rng, start) });
  }
  return employments.sort((a, b) => a.person.id - b.person.id || compareText(a.start, b.start));
}

function endAfter(rng: Rng, start: string): string | null {
  const r = rng.next();
  const tenure = r < 0.25 ? rng.int(20, 90) : r < 0.6 ? rng.int(91, 400) : rng.int(401, 1400);
  const end = addDays(start, tenure);
  return end > KONSULT_TRUTH_END ? null : end;
}

function overlap(e: Employment, month: string): [string, string] | null {
  const from = maxIso(e.start, `${month}-01`);
  const to = minIso(e.end ?? "9999-12-31", monthEndDate(month));
  return from <= to ? [from, to] : null;
}

// ---------------------------------------------------------------------------
// Intelliplan – timmar (xlsx Sep/Aug, drifted xlsx, UTF-16 CSV)
// ---------------------------------------------------------------------------

type ShiftExclusion = "presentation" | "unstaffed" | "cancelled";

interface Shift {
  a: Assignment;
  person: Person | null;
  date: string;
  hours: number;
  status: string;
  exclusion: ShiftExclusion | null;
  hoursRepr: "number" | "text" | "text_h";
  dateRepr: "date" | "dmy" | "iso";
  idAsText: boolean;
}

interface Worker {
  person: Person;
  primary: Assignment;
  dates: Set<string>;
  employment: Employment;
}

interface MonthShifts {
  month: string;
  shifts: Shift[];
  workers: Worker[];
}

function shiftReprs(rng: Rng): Pick<Shift, "hoursRepr" | "dateRepr" | "idAsText"> {
  const h = rng.next();
  const d = rng.next();
  return {
    hoursRepr: h < 0.65 ? "number" : h < 0.85 ? "text" : "text_h",
    dateRepr: d < 0.7 ? "date" : d < 0.9 ? "dmy" : "iso",
    idAsText: rng.chance(0.1),
  };
}

function generateShifts(employments: Employment[], month: string, workerCount: number) {
  const rng = new Rng(`timmar-${month}`);
  const eligible = employments.filter((e) => overlap(e, month) !== null);
  const chosen = rng.shuffle(eligible).slice(0, workerCount);
  chosen.sort((a, b) => a.person.id - b.person.id);
  const weights = ASSIGNMENTS.map((a) => [a, a.weight] as const);

  const shifts: Shift[] = [];
  const workers: Worker[] = [];
  for (const employment of chosen) {
    const range = overlap(employment, month);
    if (!range) continue;
    const days = datesInRange(range[0], range[1]);
    const primary = rng.weighted(weights);
    const secondary = rng.chance(0.2) ? rng.weighted(weights.filter(([a]) => a !== primary)) : null;
    const count = Math.min(days.length, rng.int(4, 14));
    const dates = rng.shuffle(days).slice(0, count).sort();
    for (const date of dates) {
      const a = secondary && rng.chance(0.3) ? secondary : primary;
      shifts.push({
        a,
        person: employment.person,
        date,
        hours: rng.pick(a.hours),
        status: rng.chance(0.15) ? "Attesterad" : "Exporterad",
        exclusion: null,
        ...shiftReprs(rng),
      });
    }
    workers.push({ person: employment.person, primary, dates: new Set(dates), employment });
  }

  // Cancelled shifts stay in the export with status "Makulerad".
  for (const s of rng.shuffle(shifts).slice(0, 6)) {
    s.status = "Makulerad";
    s.exclusion = "cancelled";
  }
  const monthDays = datesInRange(`${month}-01`, monthEndDate(month));
  for (let i = 0; i < 10; i++) {
    const a = rng.weighted(weights);
    shifts.push({
      a,
      person: null,
      date: rng.pick(monthDays),
      hours: rng.pick([8, 7.5, 8.25]),
      status: "Obemannad",
      exclusion: "unstaffed",
      ...shiftReprs(rng),
    });
  }
  for (let i = 0; i < 6; i++) {
    shifts.push({
      a: PRESENTATION,
      person: DEMO_PEOPLE[i % DEMO_PEOPLE.length] ?? null,
      date: rng.pick(monthDays),
      hours: rng.pick(PRESENTATION.hours),
      status: "Exporterad",
      exclusion: "presentation",
      ...shiftReprs(rng),
    });
  }

  const nameKey = (s: Shift) => (s.person ? `${s.person.last} ${s.person.first}` : "~");
  shifts.sort(
    (x, y) =>
      compareText(x.a.kundDisplay, y.a.kundDisplay) ||
      compareText(x.a.uppdrag, y.a.uppdrag) ||
      compareText(nameKey(x), nameKey(y)) ||
      compareText(x.date, y.date),
  );
  return { month, shifts, workers } satisfies MonthShifts;
}

function hoursText(s: Shift): string {
  return s.hoursRepr === "text_h" ? `${svNumber(s.hours)} h` : svNumber(s.hours);
}

function dateText(s: Shift): string {
  return s.dateRepr === "dmy" ? dayMonthYear(s.date) : s.date;
}

function timmarTruth(ms: MonthShifts): Fact[] {
  const facts = new FactSet();
  for (const s of ms.shifts) {
    if (s.exclusion !== null || !s.person) continue;
    const dims = {
      kund: s.a.kund,
      uppdrag: s.a.uppdrag,
      konsult: String(s.person.id),
      verksamhet: BEMANNING,
    };
    facts.add("timmar", "MBAB", ms.month, dims, s.hours);
    facts.add("pass", "MBAB", ms.month, dims, 1);
  }
  return facts.list();
}

function exclusionCounts(ms: MonthShifts): Record<string, number> {
  const count = (e: ShiftExclusion | null) => ms.shifts.filter((s) => s.exclusion === e).length;
  return {
    shiftRows: ms.shifts.length,
    includedShifts: count(null),
    filteredPresentationCustomer: count("presentation"),
    filteredUnstaffed: count("unstaffed"),
    filteredCancelled: count("cancelled"),
  };
}

const TIMMAR_HEADERS = [
  "Kund",
  "Uppdrag",
  "Anställnings id",
  "Konsult",
  "Personnummer",
  "Datum",
  "Timmar",
  "Status",
];

/** The September report after an Intelliplan report change: one rename, one added column. */
const TIMMAR_DRIFTED_HEADERS = [
  "Kund",
  "Uppdrag",
  "Avdelning",
  "Anställnings id",
  "Konsult",
  "Personnummer",
  "Datum",
  "Antal timmar",
  "Status",
];

function timmarSteps(): Col[] {
  return [
    {
      op: "filter",
      column: "kund",
      operator: "equals",
      value: PRESENTATION_KUND,
      caseSensitive: false,
    },
    { op: "filter", column: "anställnings id", operator: "empty", caseSensitive: false },
    {
      op: "filter",
      column: "status",
      operator: "equals",
      value: "Makulerad",
      caseSensitive: false,
    },
    { op: "clean", column: "timmar", as: "hours" },
    POSTNORD_REPLACE,
    { op: "constant", column: "verksamhet", value: BEMANNING },
  ];
}

function timmarColumns(extra: Col[] = []): Col[] {
  return [
    mapCol("kund", "text", "dimension", { dimensionKey: "kund" }),
    mapCol("uppdrag", "text", "dimension", { dimensionKey: "uppdrag" }),
    mapCol("anställnings id", "text", "dimension", { dimensionKey: "konsult" }),
    mapCol("konsult", "text", "ignore", { personal: true }),
    mapCol("personnummer", "text", "ignore", { personal: true }),
    mapCol("datum", "date", "period"),
    mapCol("timmar", "hours", "measure", { metricKey: "timmar" }),
    mapCol("status", "text", "ignore"),
    ...extra,
    mapCol("verksamhet", "text", "dimension", { dimensionKey: "verksamhet" }),
  ];
}

function timmarTemplate(drifted: boolean): Json {
  // v2 renames the new column back first, so every later step and mapping stays the same.
  const steps = drifted
    ? [{ op: "rename", column: "antal timmar", to: "timmar" }, ...timmarSteps()]
    : timmarSteps();
  const extra = drifted ? [mapCol("avdelning", "text", "ignore")] : [];
  return template(
    "ip_timmar",
    drifted
      ? "Intelliplan – timmar (fixture, v2 efter kolumnbyte)"
      : "Intelliplan – timmar (fixture)",
    drifted ? TIMMAR_DRIFTED_HEADERS : TIMMAR_HEADERS,
    {
      kind: "table",
      steps,
      columns: timmarColumns(extra),
      counters: [{ metricKey: "pass", kind: "count_rows" }],
      period: { kind: "column", column: "datum" },
      company: { kind: "fixed", company: "MBAB" },
      scenario: "utfall",
    },
  );
}

function timmarXlsx(
  ms: MonthShifts,
  variant: "plain" | "drifted",
): { bytes: Buffer; layout: SheetLayout } {
  const drifted = variant === "drifted";
  const headers = drifted ? TIMMAR_DRIFTED_HEADERS : TIMMAR_HEADERS;
  const last = headers.length - 1;
  const sheet = new SheetBuilder(
    "Tidrapport",
    drifted ? [28, 30, 14, 16, 24, 16, 12, 13, 12] : [28, 30, 16, 24, 16, 12, 10, 12],
  );
  const monthEnd = monthEndDate(ms.month);
  const printed = ms.month === "2026-09" ? "2026-10-01 08:12" : "2026-09-01 07:55";
  const titleRow = sheet.add("meta", [str("Tidrapport – attesterade och exporterade pass")]);
  sheet.merge(titleRow, 0, last);
  sheet.add("meta", [str(`Period: ${ms.month}-01 - ${monthEnd}`)]);
  sheet.add("meta", [
    str(COMPANY_INFO.MBAB.legalName),
    null,
    str(`Org.nr: ${COMPANY_INFO.MBAB.orgNr}`),
  ]);
  sheet.add(
    "header",
    headers.map((h) => str(h)),
  );

  let total = 0;
  let previousKund: string | null = null;
  for (const s of ms.shifts) {
    if (previousKund !== null && previousKund !== s.a.kundDisplay) sheet.add("empty");
    previousKund = s.a.kundDisplay;
    const id = s.person && s.exclusion !== "unstaffed" ? s.person.id : null;
    const idCell = id === null ? null : s.idAsText ? str(String(id)) : num(id);
    const hoursCell = s.hoursRepr === "number" ? num(s.hours, "0.00") : str(hoursText(s));
    const dCell = s.dateRepr === "date" ? dateCell(s.date) : str(dateText(s));
    const name = s.exclusion === "unstaffed" || !s.person ? UNSTAFFED_NAME : fullName(s.person);
    const pnr =
      s.exclusion === "unstaffed" || !s.person || !s.person.pnr ? null : str(s.person.pnr);
    const base: Cell[] = [str(s.a.kundDisplay), str(s.a.uppdrag)];
    if (drifted) base.push(str(s.a.avdelning));
    base.push(idCell, str(name), pnr, dCell, hoursCell, str(s.status));
    sheet.add("data", base);
    total += s.hours;
  }
  const totalRow: Cell[] = Array.from({ length: headers.length }, () => null);
  totalRow[0] = str("Totalt");
  totalRow[headers.length - 2] = num(round2(total), "0.00");
  sheet.add("empty");
  sheet.add("sum", totalRow);
  sheet.add("empty");
  const footer: Cell[] = Array.from({ length: headers.length }, () => null);
  footer[0] = str(`Utskrivet ${printed}`);
  footer[last] = str("Sida 1 av 1");
  sheet.add("footer", footer);
  return { bytes: writeXlsx([sheet]), layout: sheet.layout() };
}

function timmarUtf16(ms: MonthShifts): { bytes: Buffer; dataLines: number } {
  const lines = [TIMMAR_HEADERS.join("\t")];
  for (const s of ms.shifts) {
    const unstaffed = s.exclusion === "unstaffed" || !s.person;
    lines.push(
      [
        s.a.kundDisplay,
        s.a.uppdrag,
        unstaffed || !s.person ? "" : String(s.person.id),
        unstaffed || !s.person ? UNSTAFFED_NAME : fullName(s.person),
        unstaffed || !s.person ? "" : s.person.pnr,
        dateText(s),
        hoursText(s),
        s.status,
      ].join("\t"),
    );
  }
  return { bytes: encodeUtf16LeWithBom(`${lines.join("\r\n")}\r\n`), dataLines: lines.length - 1 };
}

// ---------------------------------------------------------------------------
// Intelliplan – frånvaro (CSV, windows-1252, semicolon)
// ---------------------------------------------------------------------------

const FRANVARO_HEADERS = ["Kund", "Anställnings id", "Konsult", "Datum", "Frånvaroorsak", "Timmar"];

function franvaroCsv(sep: MonthShifts) {
  const rng = new Rng("franvaro-2026-09");
  const facts = new FactSet();
  const rows: { kund: Assignment; person: Person; date: string; cause: string; hours: number }[] =
    [];
  for (const w of rng.shuffle(sep.workers).slice(0, 24)) {
    const range = overlap(w.employment, sep.month);
    if (!range) continue;
    const free = datesInRange(range[0], range[1]).filter((d) => !w.dates.has(d));
    const n = Math.min(free.length, rng.int(1, 4));
    for (const date of rng.shuffle(free).slice(0, n)) {
      const cause = rng.weighted([
        ["SJUK LO", 55],
        ["SJUK UNI", 25],
        ["Olovlig frånvaro", 20],
      ] as const);
      const hours =
        cause === "Olovlig frånvaro" ? rng.pick([8, 4]) : rng.pick([8, 7.5, 8.25, 4, 6]);
      rows.push({ kund: w.primary, person: w.person, date, cause, hours });
    }
  }
  rows.sort(
    (a, b) =>
      compareText(a.kund.kundDisplay, b.kund.kundDisplay) ||
      compareText(`${a.person.last} ${a.person.first}`, `${b.person.last} ${b.person.first}`) ||
      compareText(a.date, b.date),
  );

  const lines = [FRANVARO_HEADERS.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.kund.kundDisplay,
        String(r.person.id),
        `"${r.person.last}, ${r.person.first}"`,
        r.date,
        r.cause,
        formatNumber(r.hours, 2),
      ].join(";"),
    );
    if (r.cause === "Olovlig frånvaro") continue;
    const dims = { kund: r.kund.kund, konsult: String(r.person.id), franvarotyp: r.cause };
    facts.add("sjuktimmar", "MBAB", sep.month, dims, r.hours);
    facts.add("sjukpass", "MBAB", sep.month, dims, 1);
  }
  const olovlig = rows.filter((r) => r.cause === "Olovlig frånvaro").length;
  return {
    bytes: encodeCp1252(`${lines.join("\r\n")}\r\n`),
    truth: facts.list(),
    dataLines: rows.length,
    counts: { absenceRows: rows.length, filteredOlovligFranvaro: olovlig },
  };
}

// ---------------------------------------------------------------------------
// Intelliplan – fakturering och lön (xlsx, grouped report with subtotals)
// ---------------------------------------------------------------------------

const FAKTURERING_HEADERS = [
  "Kund",
  "Anställnings id",
  "Konsult",
  "Timmar",
  "Fakturerat belopp",
  "Lönekostnad",
];
/** Wage multiplier for employer contributions and vacation pay. */
const LONEKOSTNAD_FACTOR = 1.47;

function faktureringXlsx(sep: MonthShifts) {
  const rng = new Rng("fakturering-2026-09");
  interface Line {
    kundDisplay: string;
    kund: string;
    person: Person;
    hours: number;
    billed: number;
  }
  const lines = new Map<string, Line>();
  for (const s of sep.shifts) {
    const billable = s.exclusion === null || s.exclusion === "presentation";
    if (!billable || !s.person) continue;
    const key = `${s.a.kundDisplay}|${s.person.id}`;
    const line = lines.get(key) ?? {
      kundDisplay: s.a.kundDisplay,
      kund: s.a.kund,
      person: s.person,
      hours: 0,
      billed: 0,
    };
    line.hours += s.hours;
    line.billed += s.hours * s.a.rate;
    lines.set(key, line);
  }
  const groups = new Map<string, Line[]>();
  for (const line of [...lines.values()].sort(
    (a, b) =>
      compareText(a.kundDisplay, b.kundDisplay) ||
      compareText(fullName(a.person), fullName(b.person)),
  )) {
    groups.set(line.kundDisplay, [...(groups.get(line.kundDisplay) ?? []), line]);
  }

  const sheet = new SheetBuilder("Underlag", [30, 16, 24, 10, 18, 16]);
  const title = sheet.add("meta", [str("Fakturaunderlag och löneunderlag per kund och konsult")]);
  sheet.merge(title, 0, 5);
  sheet.add("meta", [str("Period: 2026-09-01 - 2026-09-30")]);
  sheet.add("meta", [str(`${COMPANY_INFO.MBAB.legalName}  ${COMPANY_INFO.MBAB.orgNr}`)]);
  sheet.add("empty");
  sheet.add(
    "header",
    FAKTURERING_HEADERS.map((h) => str(h)),
  );

  const facts = new FactSet();
  let textAmounts = 0;
  let presentationRows = 0;
  const totals = { hours: 0, billed: 0, salary: 0 };
  for (const [kundDisplay, group] of groups) {
    const sums = { hours: 0, billed: 0, salary: 0 };
    group.forEach((line, i) => {
      const billed = round2(line.billed);
      const salary = round2(line.hours * line.person.wage * LONEKOSTNAD_FACTOR);
      const asText = rng.chance(0.2);
      if (asText) textAmounts++;
      sheet.add("data", [
        i === 0 ? str(kundDisplay) : null,
        num(line.person.id),
        str(fullName(line.person)),
        num(round2(line.hours), "0.00"),
        asText ? str(svAmountText(billed, rng.chance(0.5))) : num(billed, AMOUNT_FMT),
        num(salary, AMOUNT_FMT),
      ]);
      sums.hours += line.hours;
      sums.billed += billed;
      sums.salary += salary;
      if (kundDisplay === PRESENTATION_KUND) {
        presentationRows++;
        return;
      }
      const dims = { kund: line.kund, konsult: String(line.person.id) };
      facts.add("fakturerat_ip", "MBAB", "2026-09", dims, billed);
      facts.add("lonekostnad", "MBAB", "2026-09", dims, salary);
    });
    sheet.add("sum", [
      str(`Summa ${kundDisplay}`),
      null,
      null,
      num(round2(sums.hours), "0.00"),
      num(round2(sums.billed), AMOUNT_FMT),
      num(round2(sums.salary), AMOUNT_FMT),
    ]);
    sheet.add("empty");
    totals.hours += sums.hours;
    totals.billed += sums.billed;
    totals.salary += sums.salary;
  }
  sheet.add("sum", [
    str("Totalt"),
    null,
    null,
    num(round2(totals.hours), "0.00"),
    num(round2(totals.billed), AMOUNT_FMT),
    num(round2(totals.salary), AMOUNT_FMT),
  ]);
  const layout = sheet.layout();
  return {
    bytes: writeXlsx([sheet]),
    layout,
    truth: facts.list(),
    counts: {
      lineRows: layout.dataRows,
      amountsAsText: textAmounts,
      filteredPresentationCustomer: presentationRows,
      groups: groups.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Cases truth (shared by konsultlista and Workbuster deltagare)
// ---------------------------------------------------------------------------

interface CaseRecord {
  company: Company;
  dims: Record<string, string>;
  start: string;
  /** Effective end (for an interruption: the interruption date, written as Slutdatum). */
  end: string | null;
  interrupted: boolean;
  result: string | null;
  /** Resultatdatum, or null when the file leaves it empty (then the end date counts). */
  resultDate: string | null;
}

interface CaseMetrics {
  active?: string;
  started?: string;
  ended?: string;
  interrupted?: string;
  results?: string;
  tenure?: string;
}

const AVG_DAYS_PER_MONTH = 365.25 / 12;

interface TenureAcc {
  company: Company;
  dims: Record<string, string>;
  sum: number;
  n: number;
}

/**
 * Monthly counts per company x group, evaluated at each month's last day (ME):
 * - active: start <= ME and (end empty or end >= ME), and not interrupted on or before ME
 * - started: start in the month; ended: end in the month; interrupted: interrupted and end in month
 * - results: result set and (Resultatdatum, else end) in the month, per resultattyp
 * - tenure: mean over active cases of (ME - start) days / (365.25 / 12)
 */
function casesTruth(cases: CaseRecord[], months: string[], metrics: CaseMetrics): Fact[] {
  const facts = new FactSet();
  const inMonth = (d: string | null, month: string) => d !== null && d.slice(0, 7) === month;
  for (const month of months) {
    const me = monthEndDate(month);
    const tenure = new Map<string, TenureAcc>();
    for (const c of cases) {
      const interruptedByMe = c.interrupted && c.end !== null && c.end <= me;
      const active = c.start <= me && (c.end === null || c.end >= me) && !interruptedByMe;
      if (metrics.active) facts.add(metrics.active, c.company, month, c.dims, active ? 1 : 0);
      if (metrics.started && inMonth(c.start, month))
        facts.add(metrics.started, c.company, month, c.dims, 1);
      if (inMonth(c.end, month)) {
        if (metrics.ended) facts.add(metrics.ended, c.company, month, c.dims, 1);
        if (metrics.interrupted && c.interrupted)
          facts.add(metrics.interrupted, c.company, month, c.dims, 1);
      }
      if (metrics.results && c.result && inMonth(c.resultDate ?? c.end, month)) {
        facts.add(metrics.results, c.company, month, { ...c.dims, resultattyp: c.result }, 1);
      }
      if (metrics.tenure && active) {
        const key = JSON.stringify([c.company, sortedDims(c.dims)]);
        const t = tenure.get(key) ?? { company: c.company, dims: c.dims, sum: 0, n: 0 };
        t.sum += daysBetween(c.start, me) / AVG_DAYS_PER_MONTH;
        t.n += 1;
        tenure.set(key, t);
      }
    }
    if (metrics.tenure) {
      for (const t of tenure.values())
        facts.add(metrics.tenure, t.company, month, t.dims, t.sum / t.n);
    }
  }
  return facts.list(new Set(metrics.tenure ? [metrics.tenure] : []));
}

// ---------------------------------------------------------------------------
// Intelliplan – konsultlista (cases)
// ---------------------------------------------------------------------------

const KONSULTER_HEADERS = [
  "Anställnings id",
  "Namn",
  "Personnummer",
  "Anställningsform",
  "Organisationsenhet",
  "Startdatum",
  "Slutdatum",
];

function konsulterXlsx(employments: Employment[]) {
  const rng = new Rng("konsulter-file");
  const sheet = new SheetBuilder("Konsulter", [16, 24, 16, 28, 22, 12, 12]);
  const title = sheet.add("meta", [str("Konsulter – samtliga anställningar")]);
  sheet.merge(title, 0, 6);
  sheet.add("meta", [str(COMPANY_INFO.MBAB.legalName)]);
  sheet.add("meta", [str(`Utdrag: ${KONSULT_EXPORT} 07:40`)]);
  sheet.add("empty");
  sheet.add(
    "header",
    KONSULTER_HEADERS.map((h) => str(h)),
  );
  const dupes = new Set(rng.shuffle(employments.map((_, i) => i)).slice(0, 2));
  const d = (iso: string | null): Cell =>
    iso === null ? null : rng.chance(0.15) ? str(iso) : dateCell(iso);
  employments.forEach((e, i) => {
    const row: Cell[] = [
      num(e.person.id),
      str(fullName(e.person)),
      str(e.person.pnr),
      str(e.person.form),
      str(`MBAB / ${e.person.ort}`),
      d(e.start),
      d(e.end),
    ];
    sheet.add("data", row);
    if (dupes.has(i)) sheet.add("data", row); // export glitch: the same employment twice
  });
  const cases: CaseRecord[] = employments.map((e) => ({
    company: "MBAB",
    dims: { ort: e.person.ort },
    start: e.start,
    end: e.end,
    interrupted: false,
    result: null,
    resultDate: null,
  }));
  const truth = casesTruth(cases, monthRange("2023-01", "2026-09"), {
    active: "anstallda_konsulter",
    started: "nyanstallda",
    ended: "avslutade_anstallningar",
    tenure: "anstallningstid",
  });
  const layout = sheet.layout();
  return {
    bytes: writeXlsx([sheet]),
    layout,
    truth,
    counts: {
      rows: layout.dataRows,
      employments: employments.length,
      duplicateRows: dupes.size,
      people: new Set(employments.map((e) => e.person.id)).size,
      rehires: employments.length - new Set(employments.map((e) => e.person.id)).size,
      activeAt20260930: employments.filter((e) => e.end === null || e.end >= KONSULT_TRUTH_END)
        .length,
    },
  };
}

// ---------------------------------------------------------------------------
// Workbuster – deltagare (cases, one file per company)
// ---------------------------------------------------------------------------

const WB_EXPORT = "2026-10-05";
const WB_HEADERS = [
  "GEN-nummer",
  "Namn",
  "Personnummer",
  "Tjänst",
  "Ort",
  "Startdatum",
  "Slutdatum",
  "Avbrott",
  "Avbrottsorsak",
  "Resultat",
  "Resultatdatum",
];

const DURATIONS: Record<string, [number, number]> = {
  ROM2: [180, 365],
  KROM: [90, 270],
  KVL: [20, 90],
  Karriärvägledning: [14, 60],
  "Stöd och matchning": [90, 365],
};

const WB_SETUP: Record<
  Company,
  { count: number; tjanster: [string, number][]; orter: [string, number][] }
> = {
  MBAB: {
    count: 300,
    tjanster: [
      ["ROM2", 40],
      ["KROM", 30],
      ["KVL", 15],
      ["Karriärvägledning", 15],
    ],
    orter: [
      ["Stockholm", 35],
      ["Södertälje", 30],
      ["Botkyrka", 20],
      ["Uppsala", 15],
    ],
  },
  MBR: {
    count: 200,
    tjanster: [
      ["Stöd och matchning", 40],
      ["KROM", 30],
      ["ROM2", 20],
      ["KVL", 10],
    ],
    orter: [
      ["Norrköping", 40],
      ["Linköping", 35],
      ["Stockholm", 25],
    ],
  },
};

const AVBROTT_REASONS = [
  "Sjukdom",
  "Flytt från orten",
  "Avaktualiserad av Arbetsförmedlingen",
  "Ej påbörjat",
  "Föräldraledighet",
  "Annan insats",
];

interface Participant {
  gen: string;
  name: string;
  pnr: string;
  tjanst: string;
  ort: string;
  start: string;
  end: string | null;
  interrupted: boolean;
  reason: string;
  result: "Arbete" | "Studier" | null;
  resultDate: string | null;
  resultDateShown: boolean;
}

function generateParticipants(company: Company): Participant[] {
  const rng = new Rng(`wb-deltagare-${company}`);
  const names = new NameGen(rng);
  const setup = WB_SETUP[company];
  const gens = new Set<string>();
  const out: Participant[] = [];
  while (out.length < setup.count) {
    const start = randomDate(rng, "2024-05-01", "2026-10-03");
    const tjanst = rng.weighted(setup.tjanster);
    const ort = rng.weighted(setup.orter);
    const [dmin, dmax] = DURATIONS[tjanst] ?? [60, 180];
    const duration = rng.int(dmin, dmax);
    const willInterrupt = rng.chance(0.13);
    const effEnd = willInterrupt
      ? addDays(start, rng.int(7, duration - 1))
      : addDays(start, duration);
    if (effEnd < "2025-01-01") continue; // the export only lists cases active since 2025
    let gen: string;
    do {
      gen = `GEN${rng.int(100000, 999999)}`;
    } while (gens.has(gen));
    gens.add(gen);
    const ended = effEnd <= WB_EXPORT;
    const interrupted = ended && willInterrupt;
    let result: Participant["result"] = null;
    let resultDate: string | null = null;
    if (ended && !interrupted) {
      const r = rng.next();
      result = r < 0.38 ? "Arbete" : r < 0.5 ? "Studier" : null;
      if (result) resultDate = maxIso(start, addDays(effEnd, -rng.int(0, 40)));
    }
    const { first, last } = names.next();
    out.push({
      gen,
      name: `${first} ${last}`,
      pnr: fakePersonnummer(rng, "short"),
      tjanst,
      ort,
      start,
      end: ended ? effEnd : null,
      interrupted,
      reason: interrupted ? rng.pick(AVBROTT_REASONS) : "",
      result,
      resultDate,
      resultDateShown: true,
    });
  }

  // Boundary cases: completed on a month's last day (still active at that month end) and
  // interrupted on a month's last day (not active at that month end).
  const completed = out.filter((p) => p.end && !p.interrupted && p.end < "2026-09-01");
  for (const p of completed.slice(0, 2)) if (p.end) p.end = monthEndDate(dateToMonth(p.end));
  const interrupted = out.find((p) => p.interrupted && p.end && p.end < "2026-09-01");
  if (interrupted?.end) interrupted.end = monthEndDate(dateToMonth(interrupted.end));
  // One case starting after the truth window (between month end and the export date).
  const late = out.find((p) => p.end === null && p.start >= "2026-08-01");
  if (late) late.start = "2026-10-02";
  // Results without Resultatdatum: counted in the month of Slutdatum.
  for (const p of out.filter((x) => x.result !== null).slice(3, 6)) p.resultDateShown = false;
  return out.sort((a, b) => compareText(a.gen, b.gen));
}

function deltagareXlsx(company: Company) {
  const rng = new Rng(`wb-deltagare-file-${company}`);
  const participants = generateParticipants(company);
  const sheet = new SheetBuilder("Deltagare", [12, 22, 14, 20, 14, 12, 12, 9, 34, 10, 13]);
  sheet.add("meta", [str(`Export från Workbuster ${WB_EXPORT} 06:30`)]);
  sheet.add("meta", [
    str(`${COMPANY_INFO[company].legalName} – deltagare aktiva någon gång sedan 2025-01-01`),
  ]);
  sheet.add("empty");
  sheet.add(
    "header",
    WB_HEADERS.map((h) => str(h)),
  );
  const d = (iso: string | null): Cell =>
    iso === null ? null : rng.chance(0.15) ? str(iso) : dateCell(iso);
  const duplicateIndex = company === "MBR" ? rng.int(20, participants.length - 20) : -1;
  participants.forEach((p, i) => {
    const avbrott = p.interrupted
      ? rng.weighted([
          ["Ja", 8],
          ["ja", 1],
          ["JA", 1],
        ] as const)
      : "";
    const result = p.result ? (rng.chance(0.15) ? p.result.toLowerCase() : p.result) : "";
    const row: Cell[] = [
      str(p.gen),
      str(p.name),
      str(p.pnr),
      str(p.tjanst),
      str(p.ort),
      d(p.start),
      d(p.end),
      avbrott ? str(avbrott) : null,
      p.reason ? str(p.reason) : null,
      result ? str(result) : null,
      p.resultDateShown ? d(p.resultDate) : null,
    ];
    sheet.add("data", row);
    if (i === duplicateIndex) sheet.add("data", row); // the same case exported twice
  });
  const cases: CaseRecord[] = participants.map((p) => ({
    company,
    dims: { verksamhet: p.tjanst, ort: p.ort },
    start: p.start,
    end: p.end,
    interrupted: p.interrupted,
    result: p.result,
    resultDate: p.resultDateShown ? p.resultDate : null,
  }));
  const truth = casesTruth(cases, monthRange("2025-01", "2026-09"), {
    active: "aktiva_deltagare",
    started: "nya_deltagare",
    ended: "avslutade_deltagare",
    interrupted: "avbrott_deltagare",
    results: "resultat_deltagare",
  });
  const layout = sheet.layout();
  return {
    bytes: writeXlsx([sheet]),
    layout,
    truth,
    counts: {
      rows: layout.dataRows,
      cases: participants.length,
      duplicateRows: duplicateIndex >= 0 ? 1 : 0,
      interrupted: participants.filter((p) => p.interrupted).length,
      withResult: participants.filter((p) => p.result).length,
      resultWithoutDate: participants.filter((p) => p.result && !p.resultDateShown).length,
      ongoingAtExport: participants.filter((p) => p.end === null).length,
      startedAfterTruthWindow: participants.filter((p) => p.start > "2026-09-30").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Workbuster – ordrar (table)
// ---------------------------------------------------------------------------

const ORDRAR_HEADERS = ["Ordernummer", "Tjänst", "Ordertyp", "Belopp", "Datum", "Ort"];

function ordrarXlsx() {
  const rng = new Rng("wb-ordrar-MBAB");
  const setup = WB_SETUP.MBAB;
  interface Order {
    tjanst: string;
    typ: string;
    amount: number;
    date: string;
    ort: string;
  }
  const orders: Order[] = [];
  for (const month of monthRange("2025-01", "2026-09")) {
    const days = datesInRange(`${month}-01`, monthEndDate(month));
    for (const [tjanst] of setup.tjanster) {
      for (const [ort] of setup.orter) {
        const push = (typ: string, amount: number) =>
          orders.push({ tjanst, typ, amount, date: rng.pick(days), ort });
        const grund = rng.int(1, 2);
        for (let i = 0; i < grund; i++) push("Grundersättning", rng.int(25, 280) * 100);
        if (rng.chance(0.5)) push("Periodersättning", rng.int(15, 90) * 100);
        if (rng.chance(0.35)) push("Resultatersättning", rng.int(60, 240) * 100);
        if (rng.chance(0.03)) push("Grundersättning", -rng.int(10, 60) * 100); // credit
      }
    }
  }
  orders.sort((a, b) => compareText(a.date, b.date));

  const sheet = new SheetBuilder("Ordrar", [14, 20, 20, 14, 12, 14]);
  sheet.add("meta", [str(`Ordrar – ${COMPANY_INFO.MBAB.legalName}`)]);
  sheet.add("meta", [str(`Exportdatum ${WB_EXPORT}`)]);
  sheet.add("empty");
  sheet.add(
    "header",
    ORDRAR_HEADERS.map((h) => str(h)),
  );
  const facts = new FactSet();
  let total = 0;
  let textAmounts = 0;
  orders.forEach((o, i) => {
    const asText = rng.chance(0.1);
    if (asText) textAmounts++;
    sheet.add("data", [
      str(`O${String(250001 + i)}`),
      str(o.tjanst),
      str(o.typ),
      asText ? str(formatNumber(o.amount, 2)) : num(o.amount, AMOUNT_FMT),
      rng.chance(0.1) ? str(o.date) : dateCell(o.date),
      str(o.ort),
    ]);
    total += o.amount;
    facts.add(
      "af_intakt",
      "MBAB",
      dateToMonth(o.date),
      { verksamhet: o.tjanst, ordertyp: o.typ, ort: o.ort },
      o.amount,
    );
  });
  sheet.add("sum", [str("Summa"), null, null, num(total, AMOUNT_FMT), null, null]);
  const layout = sheet.layout();
  return {
    bytes: writeXlsx([sheet]),
    layout,
    truth: facts.list(),
    counts: {
      orders: orders.length,
      creditOrders: orders.filter((o) => o.amount < 0).length,
      amountsAsText: textAmounts,
    },
  };
}

// ---------------------------------------------------------------------------
// Fortnox – försäljning per kund 2026 (table)
// ---------------------------------------------------------------------------

const FORTNOX_HEADERS = [
  "Fakturanr",
  "Kundnr",
  "Kund",
  "Fakturadatum",
  "Förfallodatum",
  "Belopp exkl. moms",
  "Moms",
  "Totalt",
];

const FORTNOX_CUSTOMERS: { name: string; canonical: string; nr: number; monthly: number }[] = [
  { name: "Budbee Södertälje", canonical: "Budbee Södertälje", nr: 1001, monthly: 420_000 },
  { name: "Budbee Kungsängen", canonical: "Budbee Kungsängen", nr: 1002, monthly: 260_000 },
  { name: "Early Bird AB", canonical: "Early Bird AB", nr: 1003, monthly: 190_000 },
  { name: "PRV", canonical: "PRV", nr: 1004, monthly: 80_000 },
  { name: "Bosch", canonical: "Bosch", nr: 1005, monthly: 210_000 },
  { name: "Premo", canonical: "Premo", nr: 1006, monthly: 120_000 },
  { name: "PostNord AB", canonical: "PostNord AB", nr: 1007, monthly: 240_000 },
  { name: "Postnord", canonical: "PostNord AB", nr: 1008, monthly: 140_000 },
  { name: "Arbetsförmedlingen", canonical: "Arbetsförmedlingen", nr: 1010, monthly: 310_000 },
];

function fortnoxXlsx() {
  const rng = new Rng("fortnox-kundforsaljning-2026");
  interface Invoice {
    customer: (typeof FORTNOX_CUSTOMERS)[number];
    date: string;
    amount: number;
  }
  const invoices: Invoice[] = [];
  for (const month of monthRange("2026-01", "2026-09")) {
    const days = datesInRange(`${month}-01`, monthEndDate(month));
    for (const customer of FORTNOX_CUSTOMERS) {
      const n = rng.int(1, 3);
      const volume = customer.monthly * (0.8 + rng.next() * 0.4);
      for (let i = 0; i < n; i++) {
        invoices.push({ customer, date: rng.pick(days), amount: round2(volume / n) });
      }
    }
  }
  const credits = rng.shuffle(invoices).slice(0, 6);
  for (const c of credits) {
    invoices.push({
      customer: c.customer,
      date: minIso(addDays(c.date, rng.int(3, 20)), "2026-09-30"),
      amount: -rng.amount(5_000, 40_000),
    });
  }
  invoices.sort((a, b) => compareText(a.date, b.date) || a.customer.nr - b.customer.nr);

  const sheet = new SheetBuilder("Kundfakturor", [10, 8, 24, 12, 13, 17, 14, 16]);
  sheet.add("meta", [str("Kundfakturor")]);
  sheet.add("meta", [str(`${COMPANY_INFO.MBAB.legalName} (${COMPANY_INFO.MBAB.orgNr})`)]);
  sheet.add("meta", [str("Fakturadatum 2026-01-01 – 2026-09-30")]);
  sheet.add("empty");
  sheet.add(
    "header",
    FORTNOX_HEADERS.map((h) => str(h)),
  );
  const facts = new FactSet();
  const totals = { net: 0, vat: 0, gross: 0 };
  invoices.forEach((inv, i) => {
    const vat = round2(inv.amount * 0.25);
    const gross = round2(inv.amount + vat);
    sheet.add("data", [
      num(26001 + i),
      num(inv.customer.nr),
      str(inv.customer.name),
      dateCell(inv.date),
      dateCell(addDays(inv.date, 30)),
      num(inv.amount, AMOUNT_FMT),
      num(vat, AMOUNT_FMT),
      num(gross, AMOUNT_FMT),
    ]);
    totals.net += inv.amount;
    totals.vat += vat;
    totals.gross += gross;
    facts.add(
      "fakturerat_kund",
      "MBAB",
      dateToMonth(inv.date),
      { kund: inv.customer.canonical },
      inv.amount,
    );
  });
  sheet.add("empty");
  sheet.add("sum", [
    str("Summa"),
    null,
    null,
    null,
    null,
    num(round2(totals.net), AMOUNT_FMT),
    num(round2(totals.vat), AMOUNT_FMT),
    num(round2(totals.gross), AMOUNT_FMT),
  ]);
  const layout = sheet.layout();
  return {
    bytes: writeXlsx([sheet]),
    layout,
    truth: facts.list(),
    counts: { invoices: invoices.length, creditNotes: credits.length },
  };
}

// ---------------------------------------------------------------------------
// Budget 2026 (wide, one sheet per company)
// ---------------------------------------------------------------------------

const BUDGET_ROWS: { label: string; key: string }[] = [
  { label: "Intäkter", key: "intakter" },
  { label: "Varor och underleverantörer", key: "varor_ul" },
  { label: "Övriga externa kostnader", key: "ovriga_externa" },
  { label: "Personalkostnader", key: "personal" },
  { label: "Avskrivningar", key: "avskrivningar" },
  { label: "Finansiella poster", key: "finansiella" },
];
const BUDGET_SUM_ROWS = ["Rörelseresultat", "Resultat efter finansiella poster"];
const MONTH_HEADERS = MONTH_ABBR_SV.map((m) => m.charAt(0).toUpperCase() + m.slice(1));

// prettier-ignore
const BUDGET_SETUP: Record<
  Company,
  { base: number; season: number[]; varor: number; externFix: number; externVar: number; personal: number; avskr: number; fin: number }
> = {
  MBAB: { base: 2_950_000, season: [0.93, 0.96, 1.02, 1.0, 1.03, 1.06, 0.78, 0.9, 1.07, 1.09, 1.1, 1.06], varor: 0.055, externFix: 320_000, externVar: 0.02, personal: 0.745, avskr: 14_000, fin: 4_500 },
  MBR: { base: 1_180_000, season: [1.0, 1.02, 1.04, 1.0, 0.98, 0.95, 0.7, 0.88, 1.05, 1.06, 1.05, 0.96], varor: 0.03, externFix: 205_000, externVar: 0.03, personal: 0.63, avskr: 3_500, fin: 900 },
};

function budgetSheet(company: Company, facts: FactSet): SheetBuilder {
  const rng = new Rng(`budget-2026-${company}`);
  const s = BUDGET_SETUP[company];
  const k = (x: number) => Math.round(x / 1000) * 1000;
  // Values as written in the file: revenue positive, every cost (and net finance cost) negative.
  const values: Record<string, number[]> = {};
  for (const row of BUDGET_ROWS) values[row.key] = [];
  s.season.forEach((factor) => {
    const revenue = k(s.base * factor * (0.97 + rng.next() * 0.06));
    values.intakter?.push(revenue);
    values.varor_ul?.push(-k(revenue * s.varor));
    values.ovriga_externa?.push(-k(s.externFix + revenue * s.externVar));
    values.personal?.push(-k(revenue * s.personal));
    values.avskrivningar?.push(-s.avskr);
    values.finansiella?.push(-s.fin);
  });

  const sheet = new SheetBuilder(COMPANY_INFO[company].shortName, [
    36,
    ...MONTH_HEADERS.map(() => 12),
    14,
  ]);
  const title = sheet.add("meta", [str("Budget 2026")]);
  sheet.merge(title, 0, 13);
  sheet.add("meta", [str(COMPANY_INFO[company].legalName)]);
  sheet.add("meta", [str("Belopp i kronor, kostnader med minustecken")]);
  sheet.add("empty");
  sheet.add("header", [str("Post"), ...MONTH_HEADERS.map((m) => str(m)), str("Helår")]);
  const colLetter = (c: number) => XLSX.utils.encode_col(c);
  const rowFor = (key: string, rowNo: number): Cell[] => {
    const v = values[key] ?? [];
    const sum = v.reduce((a, b) => a + b, 0);
    return [...v.map((x) => num(x, INT_FMT)), formula(`SUM(B${rowNo}:M${rowNo})`, sum, INT_FMT)];
  };
  const rowNumbers: Record<string, number> = {};
  for (const row of BUDGET_ROWS.slice(0, 5)) {
    const rowNo = sheet.rows.length + 1;
    rowNumbers[row.key] = rowNo;
    sheet.add("data", [str(row.label), ...rowFor(row.key, rowNo)]);
  }
  const ebitRow = sheet.rows.length + 1;
  const ebit = MONTH_HEADERS.map((_, m) =>
    BUDGET_ROWS.slice(0, 5).reduce((sum, r) => sum + (values[r.key]?.[m] ?? 0), 0),
  );
  sheet.add("sum", [
    str(BUDGET_SUM_ROWS[0] ?? ""),
    ...ebit.map((v, m) =>
      formula(
        `SUM(${colLetter(m + 1)}${ebitRow - 5}:${colLetter(m + 1)}${ebitRow - 1})`,
        v,
        INT_FMT,
      ),
    ),
    formula(
      `SUM(B${ebitRow}:M${ebitRow})`,
      ebit.reduce((a, b) => a + b, 0),
      INT_FMT,
    ),
  ]);
  sheet.add("empty");
  const finRow = sheet.rows.length + 1;
  sheet.add("data", [str("Finansiella poster"), ...rowFor("finansiella", finRow)]);
  const resultRow = sheet.rows.length + 1;
  const result = ebit.map((v, m) => v + (values.finansiella?.[m] ?? 0));
  sheet.add("sum", [
    str(BUDGET_SUM_ROWS[1] ?? ""),
    ...result.map((v, m) =>
      formula(`${colLetter(m + 1)}${ebitRow}+${colLetter(m + 1)}${finRow}`, v, INT_FMT),
    ),
    formula(
      `SUM(B${resultRow}:M${resultRow})`,
      result.reduce((a, b) => a + b, 0),
      INT_FMT,
    ),
  ]);

  // Intended mapping negates the amounts: budget_belopp is stored in ledger (SIE) sign.
  for (const row of BUDGET_ROWS) {
    (values[row.key] ?? []).forEach((v, m) => {
      facts.add("budget_belopp", company, `2026-${pad2(m + 1)}`, { kontogrupp: row.key }, -v);
    });
  }
  return sheet;
}

function budgetXlsx() {
  const facts = new FactSet();
  const sheets = (["MBAB", "MBR"] as const).map((c) => budgetSheet(c, facts));
  return { bytes: writeXlsx(sheets), layouts: sheets.map((s) => s.layout()), truth: facts.list() };
}

function budgetTemplate(company: Company): Json {
  const months = MONTH_HEADERS.map((m) => normalizeHeader(m));
  return template(
    "budget",
    `Budget 2026 – ${COMPANY_INFO[company].shortName} (fixture)`,
    ["Post", ...MONTH_HEADERS, "Helår"],
    {
      kind: "table",
      steps: [
        ...BUDGET_SUM_ROWS.map((value) => ({
          op: "filter",
          column: "post",
          operator: "equals",
          value,
          caseSensitive: false,
        })),
        { op: "drop", column: "helår" },
        { op: "unpivot", columns: months, nameColumn: "månad", valueColumn: "belopp" },
        { op: "constant", column: "år", value: "2026" },
        { op: "merge", columns: ["månad", "år"], separator: " ", into: "period" },
        { op: "negate", column: "belopp" },
        ...BUDGET_ROWS.map((r) => ({
          op: "replace",
          column: "post",
          find: r.label,
          replace: r.key,
          match: "whole_cell",
          caseSensitive: false,
        })),
      ],
      columns: [
        mapCol("post", "text", "dimension", { dimensionKey: "kontogrupp" }),
        mapCol("period", "date", "period"),
        mapCol("belopp", "amount", "measure", { metricKey: "budget_belopp" }),
      ],
      counters: [],
      period: { kind: "column", column: "period" },
      company: { kind: "fixed", company },
      scenario: "budget",
    },
    COMPANY_INFO[company].shortName,
  );
}

// ---------------------------------------------------------------------------
// Intelliplan – kundlista (.xls that is really an HTML table)
// ---------------------------------------------------------------------------

const KUNDLISTA: [nr: number, name: string, site: string][] = [
  [1001, "Budbee S&ouml;dert&auml;lje", "Terminal S&ouml;dert&auml;lje"],
  [1002, "Budbee Kungsängen", "Kungsängen hub"],
  [1003, "Early Bird AB", "Bromma"],
  [1003, "Early Bird AB", "V&auml;stberga"],
  [1004, "PRV", "Stockholm"],
  [1005, "Bosch", "Lager Tumba"],
  [1006, "Premo", "Arlanda"],
  [1007, "PostNord AB", "Rosersberg"],
  [1007, "PostNord AB", "&Aring;rsta"],
  [1008, "Postnord", "V&auml;stberga"],
  [1099, "Miljonbemanning Presentation (Stockholm)", "Kontoret"],
];

function kundlistaHtml(): Buffer {
  const rows = KUNDLISTA.map(
    ([nr, name, site]) => `<tr><td x:num>${nr}</td><td>${name}</td><td>${site}&nbsp;</td></tr>`,
  );
  const html = [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    "<head>",
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    "<title>Kundlista</title>",
    "</head>",
    "<body>",
    '<table border="1">',
    "<tr><th>Kundnummer</th><th>Kundnamn</th><th>Arbetsst&auml;lle</th></tr>",
    ...rows,
    "</table>",
    "</body>",
    "</html>",
  ];
  return Buffer.from(`${html.join("\r\n")}\r\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Assemble everything
// ---------------------------------------------------------------------------

const stem = (file: string) => file.replace(/\.[^.]+$/, "");

function buildAll(): Output[] {
  const employments = generateConsultants();
  const sep = generateShifts(employments, "2026-09", 45);
  const aug = generateShifts(employments, "2026-08", 42);
  const out: Output[] = [];
  const add = (
    file: string,
    bytes: Buffer,
    truth: Fact[],
    entry: Omit<ManifestEntry, "file" | "truth" | "months">,
  ) =>
    out.push({
      file,
      bytes,
      truth,
      entry: { file, truth: `${stem(file)}.json`, months: monthsOf(truth), ...entry },
    });

  const timmarTemplateV1 = timmarTemplate(false);
  const sepTruth = timmarTruth(sep);
  for (const ms of [sep, aug]) {
    const { bytes, layout } = timmarXlsx(ms, "plain");
    add(
      `intelliplan_timmar_MBAB_${ms.month}.xlsx`,
      bytes,
      ms === sep ? sepTruth : timmarTruth(ms),
      {
        format: "xlsx",
        datasetKey: "ip_timmar",
        kind: "table",
        description: `Intelliplan tidrapport ${ms.month}: titelblock med sammanfogad cell, rubrik på rad 4, pass per rad, blandade tal/text-timmar och datum, Totalt-rad och sidfot.`,
        companies: ["MBAB"],
        scenario: "utfall",
        choices: { month: ms.month, company: "MBAB" },
        exportDate: ms.month === "2026-09" ? "2026-10-01" : "2026-09-01",
        layout: [layout],
        aliases: KUND_ALIASES,
        templates: [timmarTemplateV1],
        reconcileConfig: "intelliplan_timmar.json",
        counts: exclusionCounts(ms),
      },
    );
  }

  const drifted = timmarXlsx(sep, "drifted");
  add("intelliplan_timmar_MBAB_2026-09_andrad.xlsx", drifted.bytes, sepTruth, {
    format: "xlsx",
    datasetKey: "ip_timmar",
    kind: "table",
    description:
      "Samma pass som 2026-09 men kolumnen Timmar heter Antal timmar och Avdelning har tillkommit (drift).",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: { month: "2026-09", company: "MBAB" },
    exportDate: "2026-10-01",
    layout: [drifted.layout],
    aliases: KUND_ALIASES,
    templates: [timmarTemplate(true)],
    sameTruthAs: "intelliplan_timmar_MBAB_2026-09.xlsx",
    drift: {
      fromTemplateOf: "intelliplan_timmar_MBAB_2026-09.xlsx",
      added: ["avdelning", "antal timmar"],
      removed: ["timmar"],
      renamed: [{ from: "timmar", to: "antal timmar" }],
      compatible: false,
    },
    reconcileConfig: "intelliplan_timmar.json",
    counts: exclusionCounts(sep),
  });

  const utf16 = timmarUtf16(sep);
  add("intelliplan_timmar_MBAB_2026-09_utf16.csv", utf16.bytes, sepTruth, {
    format: "csv",
    datasetKey: "ip_timmar",
    kind: "table",
    description:
      "Samma pass som 2026-09 som UTF-16LE-text med BOM, tabbseparerad, rubrik på rad 1, allt som text.",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: { month: "2026-09", company: "MBAB" },
    encoding: "utf-16le",
    delimiter: "\t",
    layout: { headerLine: 1, dataLines: utf16.dataLines, lineEnding: "CRLF" },
    aliases: KUND_ALIASES,
    templates: [timmarTemplateV1],
    sameTruthAs: "intelliplan_timmar_MBAB_2026-09.xlsx",
    reconcileConfig: "intelliplan_timmar.json",
    counts: exclusionCounts(sep),
  });

  const franvaro = franvaroCsv(sep);
  add("intelliplan_franvaro_MBAB_2026-09.csv", franvaro.bytes, franvaro.truth, {
    format: "csv",
    datasetKey: "ip_franvaro",
    kind: "table",
    description:
      "Frånvaro september: semikolonseparerad, windows-1252, svenska decimaler, konsultnamn i citattecken.",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: { month: "2026-09", company: "MBAB" },
    encoding: "windows-1252",
    delimiter: ";",
    layout: { headerLine: 1, dataLines: franvaro.dataLines, lineEnding: "CRLF" },
    aliases: KUND_ALIASES,
    templates: [
      template("ip_franvaro", "Intelliplan – frånvaro (fixture)", FRANVARO_HEADERS, {
        kind: "table",
        steps: [
          {
            op: "filter",
            column: "frånvaroorsak",
            operator: "equals",
            value: "Olovlig frånvaro",
            caseSensitive: false,
          },
          { op: "clean", column: "timmar", as: "hours" },
          POSTNORD_REPLACE,
        ],
        columns: [
          mapCol("kund", "text", "dimension", { dimensionKey: "kund" }),
          mapCol("anställnings id", "text", "dimension", { dimensionKey: "konsult" }),
          mapCol("konsult", "text", "ignore", { personal: true }),
          mapCol("datum", "date", "period"),
          mapCol("frånvaroorsak", "text", "dimension", { dimensionKey: "franvarotyp" }),
          mapCol("timmar", "hours", "measure", { metricKey: "sjuktimmar" }),
        ],
        counters: [{ metricKey: "sjukpass", kind: "count_rows" }],
        period: { kind: "column", column: "datum" },
        company: { kind: "fixed", company: "MBAB" },
        scenario: "utfall",
      }),
    ],
    reconcileConfig: "intelliplan_franvaro.json",
    counts: franvaro.counts,
  });

  const fakt = faktureringXlsx(sep);
  add("intelliplan_fakturering_MBAB_2026-09.xlsx", fakt.bytes, fakt.truth, {
    format: "xlsx",
    datasetKey: "ip_fakturering",
    kind: "table",
    description:
      "Fakturaunderlag och löneunderlag per kund och konsult: grupperad rapport (kund bara på gruppens första rad), Summa-rader per kund, Totalt, belopp ibland som text '12 345,50 kr'.",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: { month: "2026-09", company: "MBAB" },
    layout: [fakt.layout],
    aliases: KUND_ALIASES,
    templates: [
      template("ip_fakturering", "Intelliplan – fakturering (fixture)", FAKTURERING_HEADERS, {
        kind: "table",
        steps: [
          {
            op: "filter",
            column: "kund",
            operator: "contains",
            value: "summa",
            caseSensitive: false,
          },
          {
            op: "filter",
            column: "kund",
            operator: "equals",
            value: "totalt",
            caseSensitive: false,
          },
          { op: "fill_down", column: "kund" },
          {
            op: "filter",
            column: "kund",
            operator: "equals",
            value: PRESENTATION_KUND,
            caseSensitive: false,
          },
          { op: "clean", column: "fakturerat belopp", as: "amount" },
          { op: "clean", column: "lönekostnad", as: "amount" },
          POSTNORD_REPLACE,
        ],
        columns: [
          mapCol("kund", "text", "dimension", { dimensionKey: "kund" }),
          mapCol("anställnings id", "text", "dimension", { dimensionKey: "konsult" }),
          mapCol("konsult", "text", "ignore", { personal: true }),
          mapCol("timmar", "hours", "ignore"),
          mapCol("fakturerat belopp", "amount", "measure", { metricKey: "fakturerat_ip" }),
          mapCol("lönekostnad", "amount", "measure", { metricKey: "lonekostnad" }),
        ],
        counters: [],
        period: { kind: "per_upload" },
        company: { kind: "fixed", company: "MBAB" },
        scenario: "utfall",
      }),
    ],
    reconcileConfig: "intelliplan_fakturering.json",
    counts: fakt.counts,
  });

  const konsulter = konsulterXlsx(employments);
  add("intelliplan_konsulter_MBAB.xlsx", konsulter.bytes, konsulter.truth, {
    format: "xlsx",
    datasetKey: "ip_konsulter",
    kind: "cases",
    description:
      "Konsultlista med alla anställningar 2023–2026 (en rad per anställning, återanställningar med samma id, två dubblettrader).",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: { company: "MBAB", asOfDate: KONSULT_TRUTH_END },
    exportDate: KONSULT_EXPORT,
    layout: [konsulter.layout],
    aliases: {},
    templates: [
      template("ip_konsulter", "Intelliplan – konsultlista (fixture)", KONSULTER_HEADERS, {
        kind: "cases",
        steps: [
          {
            op: "replace",
            column: "organisationsenhet",
            find: "MBAB / ",
            replace: "",
            match: "contains",
            caseSensitive: false,
          },
        ],
        columns: [
          mapCol("anställnings id", "text", "case_key"),
          mapCol("namn", "text", "ignore", { personal: true }),
          mapCol("personnummer", "text", "ignore", { personal: true }),
          mapCol("anställningsform", "text", "ignore"),
          mapCol("organisationsenhet", "text", "dimension", { dimensionKey: "ort" }),
          mapCol("startdatum", "date", "case_start"),
          mapCol("slutdatum", "date", "case_end"),
        ],
        cases: {
          keyColumn: "anställnings id",
          startColumn: "startdatum",
          endColumn: "slutdatum",
          groupBy: ["organisationsenhet"],
          metrics: {
            active: "anstallda_konsulter",
            started: "nyanstallda",
            ended: "avslutade_anstallningar",
            tenureMonths: "anstallningstid",
          },
          fromMonth: "2023-01",
        },
        company: { kind: "fixed", company: "MBAB" },
      }),
    ],
    reconcileConfig: "intelliplan_konsulter.json",
    counts: konsulter.counts,
  });

  for (const company of ["MBAB", "MBR"] as const) {
    const wb = deltagareXlsx(company);
    add(`workbuster_deltagare_${company}.xlsx`, wb.bytes, wb.truth, {
      format: "xlsx",
      datasetKey: "wb_deltagare",
      kind: "cases",
      description: `Workbuster deltagarexport ${COMPANY_INFO[company].legalName}: metarad med exportdatum ${WB_EXPORT} ovanför rubriken, en rad per deltagare.`,
      companies: [company],
      scenario: "utfall",
      choices: { company, asOfDate: "2026-09-30" },
      exportDate: WB_EXPORT,
      layout: [wb.layout],
      aliases: {},
      templates: [
        template("wb_deltagare", `Workbuster – deltagare ${company} (fixture)`, WB_HEADERS, {
          kind: "cases",
          steps: [],
          columns: [
            mapCol("gen-nummer", "text", "case_key"),
            mapCol("namn", "text", "ignore", { personal: true }),
            mapCol("personnummer", "text", "ignore", { personal: true }),
            mapCol("tjänst", "text", "dimension", { dimensionKey: "verksamhet" }),
            mapCol("ort", "text", "dimension", { dimensionKey: "ort" }),
            mapCol("startdatum", "date", "case_start"),
            mapCol("slutdatum", "date", "case_end"),
            mapCol("avbrott", "text", "case_interrupt"),
            mapCol("avbrottsorsak", "text", "ignore"),
            mapCol("resultat", "text", "case_result"),
            mapCol("resultatdatum", "date", "case_result_date"),
          ],
          cases: {
            keyColumn: "gen-nummer",
            startColumn: "startdatum",
            endColumn: "slutdatum",
            interruptColumn: "avbrott",
            resultColumn: "resultat",
            resultMap: { arbete: "Arbete", studier: "Studier" },
            resultDateColumn: "resultatdatum",
            groupBy: ["tjänst", "ort"],
            metrics: {
              active: "aktiva_deltagare",
              started: "nya_deltagare",
              ended: "avslutade_deltagare",
              interrupted: "avbrott_deltagare",
              results: "resultat_deltagare",
            },
            fromMonth: "2025-01",
          },
          company: { kind: "fixed", company },
        }),
      ],
      reconcileConfig: "workbuster_deltagare.json",
      counts: wb.counts,
    });
  }

  const ordrar = ordrarXlsx();
  add("workbuster_ordrar_MBAB.xlsx", ordrar.bytes, ordrar.truth, {
    format: "xlsx",
    datasetKey: "wb_ordrar",
    kind: "table",
    description:
      "Workbuster ordrar 2025-01–2026-09 per tjänst, ordertyp och ort; några krediteringar (negativa), belopp ibland som text, Summa-rad sist.",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: { company: "MBAB" },
    exportDate: WB_EXPORT,
    layout: [ordrar.layout],
    aliases: {},
    templates: [
      template("wb_ordrar", "Workbuster – ordrar (fixture)", ORDRAR_HEADERS, {
        kind: "table",
        steps: [
          {
            op: "filter",
            column: "ordernummer",
            operator: "equals",
            value: "summa",
            caseSensitive: false,
          },
          { op: "clean", column: "belopp", as: "amount" },
        ],
        columns: [
          mapCol("ordernummer", "text", "ignore"),
          mapCol("tjänst", "text", "dimension", { dimensionKey: "verksamhet" }),
          mapCol("ordertyp", "text", "dimension", { dimensionKey: "ordertyp" }),
          mapCol("belopp", "amount", "measure", { metricKey: "af_intakt" }),
          mapCol("datum", "date", "period"),
          mapCol("ort", "text", "dimension", { dimensionKey: "ort" }),
        ],
        counters: [],
        period: { kind: "column", column: "datum" },
        company: { kind: "fixed", company: "MBAB" },
        scenario: "utfall",
      }),
    ],
    reconcileConfig: "workbuster_ordrar.json",
    counts: ordrar.counts,
  });

  const fortnox = fortnoxXlsx();
  add("fortnox_kundforsaljning_MBAB_2026.xlsx", fortnox.bytes, fortnox.truth, {
    format: "xlsx",
    datasetKey: "fx_kundforsaljning",
    kind: "table",
    description:
      "Fortnox kundfakturor 2026-01–2026-09 exkl./inkl. moms, kreditfakturor som negativa belopp, två kundposter för PostNord, Summa-rad sist.",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: { company: "MBAB" },
    layout: [fortnox.layout],
    aliases: KUND_ALIASES,
    templates: [
      template("fx_kundforsaljning", "Fortnox – kundfakturor (fixture)", FORTNOX_HEADERS, {
        kind: "table",
        steps: [
          {
            op: "filter",
            column: "fakturanr",
            operator: "equals",
            value: "summa",
            caseSensitive: false,
          },
          POSTNORD_REPLACE,
        ],
        columns: [
          mapCol("fakturanr", "text", "ignore"),
          mapCol("kundnr", "text", "ignore"),
          mapCol("kund", "text", "dimension", { dimensionKey: "kund" }),
          mapCol("fakturadatum", "date", "period"),
          mapCol("förfallodatum", "date", "ignore"),
          mapCol("belopp exkl. moms", "amount", "measure", { metricKey: "fakturerat_kund" }),
          mapCol("moms", "amount", "ignore"),
          mapCol("totalt", "amount", "ignore"),
        ],
        counters: [],
        period: { kind: "column", column: "fakturadatum" },
        company: { kind: "fixed", company: "MBAB" },
        scenario: "utfall",
      }),
    ],
    reconcileConfig: "fortnox_kundforsaljning.json",
    counts: fortnox.counts,
  });

  const budget = budgetXlsx();
  add("budget_2026.xlsx", budget.bytes, budget.truth, {
    format: "xlsx",
    datasetKey: "budget",
    kind: "table",
    description:
      "Budget 2026 i brett format, ett blad per bolag (MB AB, MB Restart), månader Jan–Dec plus Helår (formel), kostnader negativa, summarader med formler.",
    companies: ["MBAB", "MBR"],
    scenario: "budget",
    choices: {},
    layout: budget.layouts,
    aliases: {
      kontogrupp: Object.fromEntries(BUDGET_ROWS.map((r) => [r.label, r.key])),
    },
    templates: [budgetTemplate("MBAB"), budgetTemplate("MBR")],
    reconcileConfig: "budget.json",
    counts: { facts: budget.truth.length },
  });

  add("intelliplan_kundlista.xls", kundlistaHtml(), [], {
    format: "xls-html",
    datasetKey: null,
    kind: "reference",
    description:
      "Kundlista som .xls men egentligen en HTML-tabell (vanligt exportformat), HTML-entiteter för åäö. Referensdata för kund-alias, inga fakta.",
    companies: ["MBAB"],
    scenario: "utfall",
    choices: {},
    encoding: "utf-8",
    layout: { headerLine: 1, dataLines: KUNDLISTA.length, lineEnding: "CRLF" },
    aliases: KUND_ALIASES,
    templates: [],
    reconcileConfig: "intelliplan_kundlista.json",
    counts: { rows: KUNDLISTA.length, customers: new Set(KUNDLISTA.map(([nr]) => nr)).size },
  });

  return out.sort((a, b) => compareText(a.file, b.file));
}

async function formatJson(value: unknown, file: string): Promise<string> {
  const options = (await prettier.resolveConfig(join(ROOT, "fixtures/truth", file))) ?? {};
  return prettier.format(JSON.stringify(value), { ...options, parser: "json" });
}

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf("--out");
  const outArg = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  // Stale files in <out>/files and <out>/truth are deleted below, so never guess the directory.
  if (outIndex >= 0 && (!outArg || outArg.startsWith("--"))) {
    throw new Error("--out needs a directory: --out <dir>");
  }
  const outRoot = outArg ? resolve(outArg) : join(ROOT, "fixtures");
  const filesDir = join(outRoot, "files");
  const truthDir = join(outRoot, "truth");
  mkdirSync(filesDir, { recursive: true });
  mkdirSync(truthDir, { recursive: true });

  const outputs = buildAll();
  const written = new Set<string>();
  for (const o of outputs) {
    writeFileSync(join(filesDir, o.file), o.bytes);
    writeFileSync(join(truthDir, o.entry.truth), await formatJson(o.truth, o.entry.truth));
    written.add(join(filesDir, o.file));
    written.add(join(truthDir, o.entry.truth));
  }
  const manifest = {
    generator: "scripts/fixtures/generate.ts",
    seed: SEED_PREFIX,
    files: outputs.map((o) => o.entry),
  };
  writeFileSync(join(truthDir, "manifest.json"), await formatJson(manifest, "manifest.json"));
  written.add(join(truthDir, "manifest.json"));

  // Remove stale outputs from earlier generator versions.
  for (const dir of [filesDir, truthDir]) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!written.has(path) && existsSync(path)) rmSync(path);
    }
  }
  for (const o of outputs) {
    console.log(
      `${o.file.padEnd(46)} ${String(o.bytes.length).padStart(7)} B  ${o.truth.length} facts`,
    );
  }
}

await main();
