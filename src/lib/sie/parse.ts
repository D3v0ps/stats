// SIE 4 parser: turns tokenized lines into a typed SieFile. Lenient by design:
// malformed records become issues, unknown labels are counted, nothing throws.
// Dates are written YYYYMMDD and periods YYYYMM in SIE; here they become ISO
// "YYYY-MM-DD" and "YYYY-MM".
import { daysInMonth, toMonth } from "@/lib/core/month";
import { tokenizeSie, type SieField, type SieLine } from "./tokenize";

/** [dimension number, object code], e.g. [1, "100"]. */
export type SieObjectRef = [dimNo: number, code: string];

export interface SieFiscalYear {
  /** 0 = current year, -1 = previous year, ... */
  yearNo: number;
  start: string;
  end: string;
}

export interface SieBalance {
  yearNo: number;
  account: number;
  amount: number;
  quantity?: number;
}

export interface SieObjectBalance extends SieBalance {
  objects: SieObjectRef[];
}

export interface SiePeriodBalance {
  yearNo: number;
  /** "YYYY-MM" */
  period: string;
  account: number;
  /** Empty = the account total. */
  objects: SieObjectRef[];
  amount: number;
  quantity?: number;
}

export type SieTransKind = "trans" | "rtrans" | "btrans";

export interface SieTrans {
  /** trans = #TRANS, rtrans = row added afterwards, btrans = row removed afterwards. */
  kind: SieTransKind;
  account: number;
  objects: SieObjectRef[];
  amount: number;
  transdate?: string;
  text?: string;
  quantity?: number;
  /**
   * The #TRANS that, per the SIE spec's backwards-compatibility rule, repeats the
   * #RTRANS right before it. Readers that understand #RTRANS must not count it.
   */
  rtransDuplicate?: boolean;
  lineNo: number;
}

export interface SieVoucher {
  series: string;
  verno: string;
  /** null when the voucher date is missing or invalid (reported as an issue). */
  date: string | null;
  text: string;
  regdate?: string;
  /** All rows in file order, including #BTRANS and #RTRANS duplicates (flagged). */
  trans: SieTrans[];
  rtransCount: number;
  btransCount: number;
  lineNo: number;
}

export interface SieIssue {
  lineNo: number;
  label: string;
  message: string;
  value?: string;
}

export interface SieFile {
  flagga: number | null;
  format: string | null;
  sietyp: string | null;
  program: { name: string; version: string | null } | null;
  gen: { date: string; sign: string | null } | null;
  fnamn: string | null;
  orgnr: string | null;
  rar: SieFiscalYear[];
  /** account -> name */
  konto: Record<number, string>;
  /** dimension number -> name */
  dim: Record<number, string>;
  /** dimension number -> object code -> name */
  objekt: Record<number, Record<string, string>>;
  ib: SieBalance[];
  ub: SieBalance[];
  res: SieBalance[];
  oib: SieObjectBalance[];
  oub: SieObjectBalance[];
  psaldo: SiePeriodBalance[];
  pbudget: SiePeriodBalance[];
  ver: SieVoucher[];
  /** Label -> number of lines, for labels outside the SIE 4 spec. */
  unknownLabels: Record<string, number>;
  /** Non-empty lines that are neither records nor block braces. */
  otherLines: number;
  /** Record lines read (labels incl. unknown ones). */
  recordCount: number;
  /** First MAX_ISSUES problems; issueCount has the total. */
  issues: SieIssue[];
  issueCount: number;
  /** Distinct lines with at least one issue. */
  issueLineCount: number;
}

const MAX_ISSUES = 500;

/** Labels defined by SIE 4B. Those not handled below are valid but irrelevant here. */
const KNOWN_LABELS = new Set([
  "#ADRESS",
  "#BKOD",
  "#BTRANS",
  "#DIM",
  "#ENHET",
  "#FLAGGA",
  "#FNAMN",
  "#FNR",
  "#FORMAT",
  "#FTYP",
  "#GEN",
  "#IB",
  "#KONTO",
  "#KPTYP",
  "#KSUMMA",
  "#KTYP",
  "#OBJEKT",
  "#OIB",
  "#OMFATTN",
  "#ORGNR",
  "#OUB",
  "#PBUDGET",
  "#PROGRAM",
  "#PROSA",
  "#PSALDO",
  "#RAR",
  "#RES",
  "#RTRANS",
  "#SIETYP",
  "#SRU",
  "#TAXAR",
  "#TRANS",
  "#UB",
  "#UNDERDIM",
  "#VALUTA",
  "#VER",
]);

const TRANS_KINDS: Record<string, SieTransKind> = {
  "#TRANS": "trans",
  "#RTRANS": "rtrans",
  "#BTRANS": "btrans",
};

/** "20260131" (or "2026-01-31") -> "2026-01-31"; null if not a real date. */
export function parseSieDate(value: string): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const ym = toMonth(year, month);
  if (day > daysInMonth(ym)) return null;
  return `${ym}-${String(day).padStart(2, "0")}`;
}

/** "202601" (or "2026-01") -> "2026-01"; null if invalid. */
export function parseSiePeriod(value: string): string | null {
  const m = /^(\d{4})-?(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return toMonth(Number(m[1]), month);
}

/** "-1234.50" -> -1234.5. Accepts a decimal comma from sloppy writers. */
export function parseSieAmount(value: string): number | null {
  const v = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(v)) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseIntStrict(value: string): number | null {
  return /^[+-]?\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

function text(field: SieField | undefined): string | undefined {
  return field?.kind === "text" ? field.value : undefined;
}

export function parseSie(input: string): SieFile {
  const sie: SieFile = {
    flagga: null,
    format: null,
    sietyp: null,
    program: null,
    gen: null,
    fnamn: null,
    orgnr: null,
    rar: [],
    konto: {},
    dim: {},
    objekt: {},
    ib: [],
    ub: [],
    res: [],
    oib: [],
    oub: [],
    psaldo: [],
    pbudget: [],
    ver: [],
    unknownLabels: {},
    otherLines: 0,
    recordCount: 0,
    issues: [],
    issueCount: 0,
    issueLineCount: 0,
  };

  const issueLines = new Set<number>();
  const issue = (lineNo: number, label: string, message: string, value?: string) => {
    sie.issueCount++;
    if (!issueLines.has(lineNo)) {
      issueLines.add(lineNo);
      sie.issueLineCount++;
    }
    if (sie.issues.length < MAX_ISSUES) {
      sie.issues.push(
        value === undefined ? { lineNo, label, message } : { lineNo, label, message, value },
      );
    }
  };

  const tokens = tokenizeSie(input);
  for (const t of tokens.issues) issue(t.lineNo, "", t.message);

  let voucher: SieVoucher | null = null;
  let inBlock = false;
  let previousRtrans: SieTrans | null = null;

  const account = (line: RecordLine, field: SieField | undefined): number | null => {
    const raw = text(field);
    const n = raw === undefined ? null : parseIntStrict(raw);
    if (n === null || n < 1000 || n > 9999) {
      issue(line.lineNo, line.label, "Ogiltigt kontonummer", raw);
      return null;
    }
    return n;
  };
  const amount = (line: RecordLine, field: SieField | undefined): number | null => {
    const raw = text(field);
    const n = raw === undefined ? null : parseSieAmount(raw);
    if (n === null) issue(line.lineNo, line.label, "Ogiltigt belopp", raw);
    return n;
  };
  const yearNo = (line: RecordLine, field: SieField | undefined): number | null => {
    const raw = text(field);
    const n = raw === undefined ? null : parseIntStrict(raw);
    if (n === null || n > 0) issue(line.lineNo, line.label, "Ogiltigt årsnummer", raw);
    return n !== null && n <= 0 ? n : null;
  };
  const quantity = (field: SieField | undefined): number | undefined => {
    const raw = text(field);
    if (raw === undefined || raw === "") return undefined;
    return parseSieAmount(raw) ?? undefined;
  };
  const objects = (line: RecordLine, field: SieField | undefined): SieObjectRef[] => {
    if (field?.kind !== "list") return [];
    const out: SieObjectRef[] = [];
    if (field.items.length % 2 !== 0) issue(line.lineNo, line.label, "Ofullständig objektlista");
    for (let k = 0; k + 1 < field.items.length; k += 2) {
      const dimNo = parseIntStrict(field.items[k] ?? "");
      if (dimNo === null || dimNo <= 0) {
        issue(line.lineNo, line.label, "Ogiltigt dimensionsnummer", field.items[k]);
        continue;
      }
      out.push([dimNo, field.items[k + 1] ?? ""]);
    }
    return out;
  };

  for (const line of tokens.lines) {
    if (line.kind === "other") {
      sie.otherLines++;
      issue(line.lineNo, "", "Raden saknar etikett och ignorerades", line.text.slice(0, 80));
      continue;
    }
    if (line.kind === "blockStart") {
      if (voucher && !inBlock && voucher.trans.length === 0) inBlock = true;
      else issue(line.lineNo, "{", "Oväntad {");
      continue;
    }
    if (line.kind === "blockEnd") {
      if (inBlock) {
        inBlock = false;
        voucher = null;
        previousRtrans = null;
      } else {
        issue(line.lineNo, "}", "Oväntad }");
      }
      continue;
    }

    sie.recordCount++;
    const { label, fields: f } = line;
    const transKind = TRANS_KINDS[label];

    if (transKind) {
      if (!voucher || !inBlock) {
        issue(line.lineNo, label, "Transaktionsrad utanför verifikation ignorerades");
        continue;
      }
      // SIE 4 always has an object list, but tolerate writers that omit it.
      const hasList = f[1]?.kind === "list";
      const off = hasList ? 0 : -1;
      const acc = account(line, f[0]);
      const amt = amount(line, f[2 + off]);
      if (acc === null || amt === null) {
        previousRtrans = null;
        continue;
      }
      const tr: SieTrans = {
        kind: transKind,
        account: acc,
        objects: objects(line, f[1]),
        amount: amt,
        lineNo: line.lineNo,
      };
      const rawDate = text(f[3 + off]);
      if (rawDate) {
        const d = parseSieDate(rawDate);
        if (d) tr.transdate = d;
        else issue(line.lineNo, label, "Ogiltigt transaktionsdatum", rawDate);
      }
      const transText = text(f[4 + off]);
      if (transText) tr.text = transText;
      const qty = quantity(f[5 + off]);
      if (qty !== undefined) tr.quantity = qty;

      if (transKind === "trans" && previousRtrans && sameRow(previousRtrans, tr)) {
        tr.rtransDuplicate = true;
      }
      previousRtrans = transKind === "rtrans" ? tr : null;
      if (transKind === "rtrans") voucher.rtransCount++;
      if (transKind === "btrans") voucher.btransCount++;
      voucher.trans.push(tr);
      continue;
    }

    if (inBlock) {
      issue(line.lineNo, label, "Verifikationen saknar avslutande }");
      inBlock = false;
    }
    voucher = null;
    previousRtrans = null;

    switch (label) {
      case "#FLAGGA":
        sie.flagga = parseIntStrict(text(f[0]) ?? "");
        break;
      case "#FORMAT":
        sie.format = text(f[0]) ?? null;
        break;
      case "#SIETYP":
        sie.sietyp = text(f[0]) ?? null;
        break;
      case "#PROGRAM":
        sie.program = { name: text(f[0]) ?? "", version: text(f[1]) ?? null };
        break;
      case "#GEN": {
        const d = parseSieDate(text(f[0]) ?? "");
        if (d) sie.gen = { date: d, sign: text(f[1]) || null };
        else issue(line.lineNo, label, "Ogiltigt datum", text(f[0]));
        break;
      }
      case "#FNAMN":
        sie.fnamn = text(f[0]) ?? null;
        break;
      case "#ORGNR":
        sie.orgnr = text(f[0]) || null;
        break;
      case "#RAR": {
        const y = yearNo(line, f[0]);
        const start = parseSieDate(text(f[1]) ?? "");
        const end = parseSieDate(text(f[2]) ?? "");
        if (y === null) break;
        if (!start || !end || start > end) {
          issue(line.lineNo, label, "Ogiltigt räkenskapsår", `${text(f[1])} ${text(f[2])}`);
          break;
        }
        sie.rar = sie.rar.filter((r) => r.yearNo !== y);
        sie.rar.push({ yearNo: y, start, end });
        break;
      }
      case "#KONTO": {
        const acc = account(line, f[0]);
        if (acc !== null) sie.konto[acc] = text(f[1]) ?? "";
        break;
      }
      case "#DIM":
      case "#UNDERDIM": {
        const d = parseIntStrict(text(f[0]) ?? "");
        if (d === null || d <= 0)
          issue(line.lineNo, label, "Ogiltigt dimensionsnummer", text(f[0]));
        else sie.dim[d] = text(f[1]) ?? "";
        break;
      }
      case "#OBJEKT": {
        const d = parseIntStrict(text(f[0]) ?? "");
        const code = text(f[1]);
        if (d === null || d <= 0 || code === undefined) {
          issue(line.lineNo, label, "Ogiltigt objekt", text(f[0]));
          break;
        }
        (sie.objekt[d] ??= {})[code] = text(f[2]) ?? "";
        break;
      }
      case "#IB":
      case "#UB":
      case "#RES": {
        const y = yearNo(line, f[0]);
        const acc = account(line, f[1]);
        const amt = amount(line, f[2]);
        if (y === null || acc === null || amt === null) break;
        const entry: SieBalance = { yearNo: y, account: acc, amount: amt };
        const qty = quantity(f[3]);
        if (qty !== undefined) entry.quantity = qty;
        (label === "#IB" ? sie.ib : label === "#UB" ? sie.ub : sie.res).push(entry);
        break;
      }
      case "#OIB":
      case "#OUB": {
        const y = yearNo(line, f[0]);
        const acc = account(line, f[1]);
        const amt = amount(line, f[3]);
        if (y === null || acc === null || amt === null) break;
        const entry: SieObjectBalance = {
          yearNo: y,
          account: acc,
          objects: objects(line, f[2]),
          amount: amt,
        };
        const qty = quantity(f[4]);
        if (qty !== undefined) entry.quantity = qty;
        (label === "#OIB" ? sie.oib : sie.oub).push(entry);
        break;
      }
      case "#PSALDO":
      case "#PBUDGET": {
        const y = yearNo(line, f[0]);
        const period = parseSiePeriod(text(f[1]) ?? "");
        if (!period) issue(line.lineNo, label, "Ogiltig period", text(f[1]));
        const hasList = f[3]?.kind === "list";
        const off = hasList ? 0 : -1;
        const acc = account(line, f[2]);
        const amt = amount(line, f[4 + off]);
        if (y === null || !period || acc === null || amt === null) break;
        const entry: SiePeriodBalance = {
          yearNo: y,
          period,
          account: acc,
          objects: objects(line, f[3]),
          amount: amt,
        };
        const qty = quantity(f[5 + off]);
        if (qty !== undefined) entry.quantity = qty;
        (label === "#PSALDO" ? sie.psaldo : sie.pbudget).push(entry);
        break;
      }
      case "#VER": {
        const rawDate = text(f[2]) ?? "";
        const date = parseSieDate(rawDate);
        if (!date) issue(line.lineNo, label, "Ogiltigt verifikationsdatum", rawDate);
        const regdate = parseSieDate(text(f[4]) ?? "");
        voucher = {
          series: text(f[0]) ?? "",
          verno: text(f[1]) ?? "",
          date,
          text: text(f[3]) ?? "",
          trans: [],
          rtransCount: 0,
          btransCount: 0,
          lineNo: line.lineNo,
        };
        if (regdate) voucher.regdate = regdate;
        sie.ver.push(voucher);
        break;
      }
      default:
        if (!KNOWN_LABELS.has(label)) {
          sie.unknownLabels[label] = (sie.unknownLabels[label] ?? 0) + 1;
        }
    }
  }
  if (inBlock)
    issue(tokens.lines.at(-1)?.lineNo ?? 0, "#VER", "Verifikationen saknar avslutande }");

  sie.rar.sort((a, b) => b.yearNo - a.yearNo);
  return sie;
}

type RecordLine = Extract<SieLine, { kind: "record" }>;

function objectKey(objects: SieObjectRef[]): string {
  return objects
    .map(([d, c]) => `${d}\u0000${c}`)
    .sort()
    .join("\u0001");
}

/** Same account, objects and amount: the #TRANS that mirrors an #RTRANS. */
function sameRow(a: SieTrans, b: SieTrans): boolean {
  return (
    a.account === b.account &&
    Math.round(a.amount * 100) === Math.round(b.amount * 100) &&
    objectKey(a.objects) === objectKey(b.objects)
  );
}
