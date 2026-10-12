// Deterministic generator for synthetic SIE4 test files and their ground truth.
//
//   node --experimental-strip-types scripts/fixtures/sie.ts
//
// Writes fixtures/sie/*.se (CP437, one file Windows-1252) and
// fixtures/sie/truth/*.json. The truth is computed here from the generator's own
// voucher list and never through src/lib/sie, so the parser is tested against
// an independent oracle. All amounts are integer öre; all data is synthetic.
// Self-contained on purpose (no imports from src/): the encoders below only know
// the characters the fixtures use and throw on anything else.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Obj = readonly [dimNo: number, code: string];
type RowKind = "trans" | "rtrans" | "btrans";
type Encoding = "cp437" | "windows-1252";
type PsaldoMode = "movement" | "cumulative" | "none";

interface Row {
  account: number;
  objects: Obj[];
  ore: number;
  /** rtrans is written as #RTRANS followed by its duplicate #TRANS (SIE compatibility rule). */
  kind: RowKind;
  transdate?: string;
  text?: string;
}

interface Voucher {
  series: string;
  verno: number;
  date: string;
  text: string;
  rows: Row[];
}

interface FiscalYear {
  yearNo: number;
  start: string;
  end: string;
}

interface FixtureSpec {
  file: string;
  encoding: Encoding;
  eol: "\r\n" | "\n";
  /** Indentation of #TRANS lines and whether object lists quote the dimension number. */
  transIndent: string;
  quoteDims: boolean;
  quoteVerIds: boolean;
  fnamn: string;
  orgnr: string;
  company: "MBAB" | "MBR" | null;
  years: FiscalYear[];
  /** Every generated voucher per yearNo (also those not written as #VER). */
  vouchers: Map<number, Voucher[]>;
  psaldo: PsaldoMode;
  psaldoYears: number[];
  verYears: number[];
  accounts: Record<number, string>;
  dims: Record<number, string>;
  objects: Record<number, Record<string, string>>;
  /** Opening balances (öre) of the earliest year for these balance accounts. */
  openingBalances: Record<number, number>;
  pbudget: boolean;
}

export interface GeneratedFixture {
  /** Path relative to fixtures/sie/. */
  path: string;
  bytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Encoding (only the characters the fixtures need)

const CP437_SWEDISH: Record<string, number> = {
  ü: 0x81,
  é: 0x82,
  ä: 0x84,
  å: 0x86,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  ö: 0x94,
  Ö: 0x99,
};

function encode(text: string, encoding: Encoding): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    let byte: number | undefined;
    if (cp < 0x80) byte = cp;
    else if (encoding === "cp437") byte = CP437_SWEDISH[char];
    else if (cp >= 0xa0 && cp <= 0xff) byte = cp; // Windows-1252 equals Latin-1 here
    if (byte === undefined) throw new Error(`Cannot encode ${JSON.stringify(char)} as ${encoding}`);
    out[n++] = byte;
  }
  return out.subarray(0, n);
}

// ---------------------------------------------------------------------------
// Small helpers

type Rng = () => number;

/** mulberry32: tiny deterministic PRNG. */
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random amount in öre between minKr and maxKr. */
function randOre(r: Rng, minKr: number, maxKr: number): number {
  return Math.round(minKr * 100 + r() * (maxKr - minKr) * 100);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function lastDay(ym: string): number {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

function monthsOf(year: FiscalYear, last?: string): string[] {
  const out: string[] = [];
  for (
    let ym = year.start.slice(0, 7);
    ym <= (last ?? year.end.slice(0, 7));
    ym = addMonths(ym, 1)
  ) {
    out.push(ym);
  }
  return out;
}

const SV_MONTHS = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

function row(
  account: number,
  objects: Obj[],
  ore: number,
  extra: { kind?: RowKind; transdate?: string; text?: string } = {},
): Row {
  const r: Row = { account, objects, ore, kind: extra.kind ?? "trans" };
  if (extra.transdate) r.transdate = extra.transdate;
  if (extra.text) r.text = extra.text;
  return r;
}

class Numbering {
  private readonly next = new Map<string, number>();
  take(series: string): number {
    const n = (this.next.get(series) ?? 0) + 1;
    this.next.set(series, n);
    return n;
  }
}

function monthContext(ym: string, numbering: Numbering) {
  const month = Number(ym.slice(5, 7));
  const out: Voucher[] = [];
  return {
    month,
    name: SV_MONTHS[month - 1] ?? "",
    end: lastDay(ym),
    day: (d: number) => `${ym}-${pad2(Math.min(d, lastDay(ym)))}`,
    out,
    add(series: string, date: string, text: string, rows: Row[]) {
      out.push({ series, verno: numbering.take(series), date, text, rows });
    },
  };
}

// ---------------------------------------------------------------------------
// Bookkeeping generators

const MBAB_ACCOUNTS: Record<number, string> = {
  1229: "Ackumulerade avskrivningar på inventarier och verktyg",
  1510: "Kundfordringar",
  1930: "Företagskonto/checkkonto/affärskonto",
  2440: "Leverantörsskulder",
  2610: "Utgående moms, 25 %",
  2640: "Ingående moms",
  2710: "Personalskatt",
  2731: "Avräkning lagstadgade sociala avgifter",
  3041: "Försäljning tjänster 25 %",
  3740: "Öres- och kronutjämning",
  3990: "Övriga ersättningar och intäkter",
  4600: "Legoarbeten och underentreprenader",
  5010: "Lokalhyra",
  6110: "Kontorsmateriel",
  6212: "Mobiltelefon",
  7010: "Löner till kollektivanställda",
  7210: "Löner till tjänstemän",
  7510: "Arbetsgivaravgifter 31,42 %",
  7832: "Avskrivningar på inventarier och verktyg",
  8310: "Ränteintäkter från omsättningstillgångar",
  8410: "Räntekostnader för långfristiga skulder",
};

const MBAB_OBJECTS: Record<number, Record<string, string>> = {
  1: { "100": "Bemanning", "200": "Omställning", "8": "Overhead kostnader" },
  6: { P1: "Projekt Älvsjö", P2: "Projekt Örebro" },
};

const MBR_ACCOUNTS: Record<number, string> = {
  1510: "Kundfordringar",
  1930: "Företagskonto/checkkonto/affärskonto",
  2440: "Leverantörsskulder",
  2640: "Ingående moms",
  2710: "Personalskatt",
  2731: "Avräkning lagstadgade sociala avgifter",
  3050: "Försäljning tjänster till Arbetsförmedlingen, momsfri",
  5010: "Lokalhyra",
  5410: "Förbrukningsinventarier",
  5460: "Förbrukningsmaterial",
  6110: "Kontorsmateriel",
  6540: 'IT-tjänster "molnet"',
  7210: "Löner till tjänstemän",
  7510: "Arbetsgivaravgifter 31,42 %",
  8410: "Räntekostnader för långfristiga skulder",
};

const MBR_OBJECTS: Record<number, Record<string, string>> = {
  1: { "410": "KROM", "420": "Rusta och matcha", "8": "Overhead kostnader" },
};

function mbabMonth(r: Rng, ym: string, numbering: Numbering): Voucher[] {
  const c = monthContext(ym, numbering);
  const { day, add, name } = c;

  add("D", day(1), `Hyra kontor ${name}`, [
    row(5010, [[1, "8"]], 4_500_000),
    row(2640, [], 1_125_000),
    row(2440, [], -5_625_000),
  ]);

  // Subcontractors are booked on a cost centre and a project (two objects).
  const ul = randOre(r, 40_000, 90_000);
  const ulVat = Math.round(ul / 4);
  const [cc, project] = c.month % 2 === 1 ? ["100", "P1"] : ["200", "P2"];
  add("D", day(12), "Underkonsult", [
    row(
      4600,
      [
        [1, cc],
        [6, project],
      ],
      ul,
    ),
    row(2640, [], ulVat),
    row(2440, [], -(ul + ulVat)),
  ]);

  const office = randOre(r, 1_200, 6_500);
  const phone = randOre(r, 900, 2_400);
  const vat = Math.round((office + phone) / 4);
  add("D", day(15), "Kontorsmaterial och telefoni", [
    row(6110, [], office),
    row(6212, [[1, "100"]], phone),
    row(2640, [], vat),
    row(2440, [], -(office + phone + vat)),
  ]);

  const paid = randOre(r, 700_000, 1_100_000);
  add("C", day(18), "Inbetalningar kunder", [row(1930, [], paid), row(1510, [], -paid)]);

  const other = randOre(r, 1_500, 12_000);
  add("A", day(20), "Vidarefakturerade utlägg", [row(1930, [], other), row(3990, [], -other)]);

  const w100 = randOre(r, 380_000, 520_000);
  const w200 = randOre(r, 120_000, 190_000);
  const w8 = randOre(r, 90_000, 110_000);
  const [c100, c200, c8] = [w100, w200, w8].map((w) => Math.round(w * 0.3142)) as [
    number,
    number,
    number,
  ];
  const wages = w100 + w200 + w8;
  const tax = Math.round(wages * 0.3);
  add("L", day(25), `Lön ${name}`, [
    row(7010, [[1, "100"]], w100),
    row(7010, [[1, "200"]], w200),
    row(7210, [[1, "8"]], w8),
    row(7510, [[1, "100"]], c100),
    row(7510, [[1, "200"]], c200),
    row(7510, [[1, "8"]], c8),
    row(2710, [], -tax),
    row(2731, [], -(c100 + c200 + c8)),
    row(1930, [], -(wages - tax)),
  ]);

  for (const [code, lo, hi, label] of [
    ["100", 600_000, 900_000, "bemanning"],
    ["200", 180_000, 320_000, "omställning"],
  ] as const) {
    const net = randOre(r, lo, hi);
    const outVat = Math.round(net / 4);
    add("B", day(28), `Kundfakturor ${label} ${name}`, [
      row(1510, [], net + outVat),
      row(3041, [[1, code]], -net),
      row(2610, [], -outVat),
    ]);
  }

  add("A", day(c.end), "Avskrivningar inventarier", [
    row(7832, [], 500_000),
    row(1229, [], -500_000),
  ]);
  const interest = randOre(r, 800, 2_500);
  add("A", day(c.end), "Ränta lån", [row(8410, [], interest), row(1930, [], -interest)]);
  if (c.month % 3 === 0) {
    const income = randOre(r, 200, 900);
    add("A", day(c.end), "Ränteintäkt", [row(1930, [], income), row(8310, [], -income)]);
  }
  return c.out;
}

/**
 * MB Restart month. With `specials`, adds the cases the voucher fallback must
 * handle: transdates differing from the voucher date (same month, previous
 * month, next month, previous fiscal year), #RTRANS rows and #BTRANS rows.
 */
function mbrMonth(r: Rng, ym: string, numbering: Numbering, specials: boolean): Voucher[] {
  const c = monthContext(ym, numbering);
  const { day, add, name } = c;
  const monthEnd = day(c.end);

  add("D", day(1), `Hyra ${name}`, [
    row(5010, [[1, "8"]], 2_200_000),
    row(2640, [], 550_000),
    row(2440, [], -2_750_000),
  ]);

  // Supplier invoice received on the 3rd, costs accrued to the previous month.
  const prevEnd = `${addMonths(ym, -1)}-${pad2(lastDay(addMonths(ym, -1)))}`;
  const supplies = randOre(r, 800, 4_000);
  const material = randOre(r, 500, 3_000);
  const supVat = Math.round((supplies + material) / 4);
  const accrual = specials ? { transdate: prevEnd } : {};
  add("D", day(3), "Leverantörsfaktura förbrukning", [
    row(6110, [], supplies, { ...accrual, text: specials ? "Periodiserad" : undefined }),
    row(5460, [[1, "410"]], material, accrual),
    row(2640, [], supVat),
    row(2440, [], -(supplies + material + supVat)),
  ]);

  const w410 = randOre(r, 160_000, 240_000);
  const w420 = randOre(r, 70_000, 120_000);
  const w8 = randOre(r, 55_000, 70_000);
  const contrib = [w410, w420, w8].map((w) => Math.round(w * 0.3142)) as [number, number, number];
  const wages = w410 + w420 + w8;
  const tax = Math.round(wages * 0.3);
  const salaryDate = specials ? { transdate: monthEnd } : {};
  add("L", day(25), `Lön ${name}`, [
    row(7210, [[1, "410"]], w410, salaryDate),
    row(7210, [[1, "420"]], w420, salaryDate),
    row(7210, [[1, "8"]], w8, salaryDate),
    row(7510, [[1, "410"]], contrib[0], salaryDate),
    row(7510, [[1, "420"]], contrib[1], salaryDate),
    row(7510, [[1, "8"]], contrib[2], salaryDate),
    row(2710, [], -tax),
    row(2731, [], -(contrib[0] + contrib[1] + contrib[2])),
    row(1930, [], -(wages - tax)),
  ]);

  for (const [code, lo, hi] of [
    ["410", 250_000, 420_000],
    ["420", 90_000, 160_000],
  ] as const) {
    const net = randOre(r, lo, hi);
    add("B", monthEnd, `Faktura Arbetsförmedlingen ${MBR_OBJECTS[1]?.[code]} ${name}`, [
      row(1510, [], net),
      row(3050, [[1, code]], -net),
    ]);
  }

  const paid = randOre(r, 300_000, 520_000);
  add("C", day(20), "Inbetalning Arbetsförmedlingen", [row(1930, [], paid), row(1510, [], -paid)]);

  const interest = randOre(r, 300, 1_200);
  add("A", monthEnd, "Ränta", [row(8410, [], interest), row(1930, [], -interest)]);

  if (!specials) return c.out;

  if (c.month === 4 || c.month === 7) {
    // Booked on the last day of the month, belongs to the next month.
    const it = randOre(r, 2_000, 6_000);
    const itVat = Math.round(it / 4);
    add("D", monthEnd, "IT-tjänster förskott", [
      row(6540, [], it, { transdate: `${addMonths(ym, 1)}-01`, text: "Avser nästa månad" }),
      row(2640, [], itVat),
      row(2440, [], -(it + itVat)),
    ]);
  }
  if (c.month === 3 || c.month === 6) {
    add("A", day(10), "Rättelse kontorsmaterial", [
      row(1930, [], -150_000),
      row(6110, [], 100_000),
      row(6110, [], 50_000, { kind: "rtrans", text: "Tillagd rad" }),
    ]);
  }
  if (c.month === 5) {
    add("A", day(12), "Rättelse lön", [
      row(1930, [], -200_000),
      row(7210, [[1, "410"]], 200_000, { kind: "rtrans", transdate: day(12), text: "Tillagd" }),
    ]);
  }
  if (c.month === 4 || c.month === 8) {
    add("A", day(16), "Omföring förbrukning", [
      row(1930, [], -80_000),
      row(5410, [], 80_000, { kind: "btrans", text: "Borttagen rad" }),
      row(5460, [[1, "420"]], 80_000, { kind: "rtrans", text: "Rätt konto" }),
    ]);
  }
  return c.out;
}

function generateYear(
  months: string[],
  seed: number,
  month: (r: Rng, ym: string, numbering: Numbering) => Voucher[],
): Voucher[] {
  const r = rng(seed);
  const numbering = new Numbering();
  const vouchers = months.flatMap((ym) => month(r, ym, numbering));
  for (const v of vouchers) {
    const sum = v.rows.filter((x) => x.kind !== "btrans").reduce((a, x) => a + x.ore, 0);
    if (sum !== 0) throw new Error(`Unbalanced voucher ${v.series}${v.verno} ${v.date}: ${sum}`);
  }
  return vouchers;
}

// ---------------------------------------------------------------------------
// Aggregation (shared by the SIE writer and the truth)

/** The month a row's amount belongs to: its transdate when inside the fiscal year, else the voucher date. */
function rowMonth(v: Voucher, x: Row, year: FiscalYear): string {
  const d =
    x.transdate && x.transdate >= year.start && x.transdate <= year.end ? x.transdate : v.date;
  return d.slice(0, 7);
}

/** account -> month -> series ("" = total, "1|100" = object, "1|100;6|P1" = combination) -> öre */
type Aggregate = Map<number, Map<string, Map<string, number>>>;

function aggregate(vouchers: Voucher[], year: FiscalYear): Aggregate {
  const agg: Aggregate = new Map();
  const bump = (account: number, month: string, series: string, ore: number) => {
    const byMonth = agg.get(account) ?? new Map<string, Map<string, number>>();
    agg.set(account, byMonth);
    const bySeries = byMonth.get(month) ?? new Map<string, number>();
    byMonth.set(month, bySeries);
    bySeries.set(series, (bySeries.get(series) ?? 0) + ore);
  };
  for (const v of vouchers) {
    if (v.date < year.start || v.date > year.end) continue;
    for (const x of v.rows) {
      if (x.kind === "btrans") continue;
      const month = rowMonth(v, x, year);
      bump(x.account, month, "", x.ore);
      for (const [dimNo, code] of x.objects) bump(x.account, month, `${dimNo}|${code}`, x.ore);
      if (x.objects.length > 1) {
        bump(x.account, month, x.objects.map(([d, code]) => `${d}|${code}`).join(";"), x.ore);
      }
    }
  }
  return agg;
}

const isResult = (account: number) => account >= 3000 && account <= 8999;
const sortedNum = <T>(m: Map<number, T>) => [...m.entries()].sort(([a], [b]) => a - b);
const sortedStr = <T>(m: Map<string, T>) =>
  [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function accountTotals(agg: Aggregate): Map<number, number> {
  const out = new Map<number, number>();
  for (const [account, byMonth] of agg) {
    let sum = 0;
    for (const bySeries of byMonth.values()) sum += bySeries.get("") ?? 0;
    out.set(account, sum);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SIE writer

function fmtOre(ore: number): string {
  const sign = ore < 0 ? "-" : "";
  const abs = Math.abs(ore);
  return `${sign}${Math.floor(abs / 100)}.${pad2(abs % 100)}`;
}

const sieDate = (iso: string) => iso.replaceAll("-", "");
const quote = (s: string) => `"${s.replaceAll('"', '\\"')}"`;

function objectList(series: string, quoteDims: boolean): string {
  if (series === "") return "{}";
  const parts = series.split(";").map((s) => {
    const [dim, code] = s.split("|") as [string, string];
    return `${quoteDims ? quote(dim) : dim} ${quote(code)}`;
  });
  return `{${parts.join(" ")}}`;
}

function objectsToSeries(objects: Obj[]): string {
  return objects.map(([d, c]) => `${d}|${c}`).join(";");
}

function writeSie(spec: FixtureSpec): string {
  const L: string[] = [];
  const yearOf = (yearNo: number) => spec.years.find((y) => y.yearNo === yearNo) as FiscalYear;
  L.push("#FLAGGA 0");
  L.push("#FORMAT PC8");
  L.push("#SIETYP 4");
  L.push('#PROGRAM "MB Stats testgenerator" "1.0"');
  L.push('#GEN 20261005 "Syntetisk"');
  L.push(`#FNAMN ${quote(spec.fnamn)}`);
  L.push(`#ORGNR ${spec.orgnr}`);
  for (const y of spec.years) L.push(`#RAR ${y.yearNo} ${sieDate(y.start)} ${sieDate(y.end)}`);
  L.push("#KPTYP EUBAS97");
  L.push("#VALUTA SEK");
  for (const [account, name] of Object.entries(spec.accounts)) {
    L.push(`#KONTO ${account} ${quote(name)}`);
    const n = Number(account);
    L.push(`#KTYP ${account} ${n < 2000 ? "T" : n < 3000 ? "S" : n < 4000 ? "I" : "K"}`);
  }
  const firstIncome = Object.keys(spec.accounts).find((a) => a.startsWith("3"));
  if (firstIncome) L.push(`#SRU ${firstIncome} 7410`);
  for (const [dim, name] of Object.entries(spec.dims)) L.push(`#DIM ${dim} ${quote(name)}`);
  for (const [dim, objects] of Object.entries(spec.objects)) {
    for (const [code, name] of Object.entries(objects)) {
      L.push(`#OBJEKT ${dim} ${quote(code)} ${quote(name)}`);
    }
  }

  // Balances: chain IB -> UB year by year from the opening balances.
  const chrono = [...spec.years].sort((a, b) => a.yearNo - b.yearNo);
  const balances = new Map<number, { ib: Map<number, number>; ub: Map<number, number> }>();
  let opening = new Map(Object.entries(spec.openingBalances).map(([a, v]) => [Number(a), v]));
  for (const y of chrono) {
    const totals = accountTotals(aggregate(spec.vouchers.get(y.yearNo) ?? [], y));
    const ub = new Map(opening);
    for (const [account, sum] of totals) {
      if (!isResult(account) && opening.has(account)) ub.set(account, (ub.get(account) ?? 0) + sum);
    }
    balances.set(y.yearNo, { ib: opening, ub });
    opening = ub;
  }
  for (const y of spec.years) {
    const b = balances.get(y.yearNo);
    if (!b) continue;
    for (const [account, ore] of sortedNum(b.ib))
      L.push(`#IB ${y.yearNo} ${account} ${fmtOre(ore)}`);
    for (const [account, ore] of sortedNum(b.ub))
      L.push(`#UB ${y.yearNo} ${account} ${fmtOre(ore)}`);
  }
  for (const y of spec.years) {
    const totals = accountTotals(aggregate(spec.vouchers.get(y.yearNo) ?? [], y));
    for (const [account, ore] of sortedNum(totals)) {
      if (isResult(account)) L.push(`#RES ${y.yearNo} ${account} ${fmtOre(ore)}`);
    }
  }

  for (const yearNo of spec.psaldoYears) {
    const year = yearOf(yearNo);
    const agg = aggregate(spec.vouchers.get(yearNo) ?? [], year);
    for (const [account, byMonth] of sortedNum(agg)) {
      // Period balances for result accounts plus the bank account (ignored by the ledger).
      if (!isResult(account) && account !== 1930) continue;
      const months = sortedStr(byMonth);
      if (spec.psaldo === "movement") {
        for (const [month, bySeries] of months) {
          for (const [series, ore] of sortedStr(bySeries)) {
            L.push(
              `#PSALDO ${yearNo} ${month.replace("-", "")} ${account} ${objectList(series, spec.quoteDims)} ${fmtOre(ore)}`,
            );
          }
        }
        continue;
      }
      // Cumulative: running year-to-date balance per series. Written for every
      // month from the series' first month, except interest income (8310), which
      // is only written in months with a movement to exercise gaps.
      const allSeries = new Set<string>();
      for (const [, bySeries] of months) for (const s of bySeries.keys()) allSeries.add(s);
      const firstMonth = months[0]?.[0] ?? "";
      const lastMonth = months.at(-1)?.[0] ?? "";
      for (const series of [...allSeries].sort()) {
        let running = 0;
        let started = false;
        for (let ym = firstMonth; ym <= lastMonth; ym = addMonths(ym, 1)) {
          const ore = byMonth.get(ym)?.get(series);
          if (ore !== undefined) {
            running += ore;
            started = true;
          }
          if (!started || (account === 8310 && ore === undefined)) continue;
          L.push(
            `#PSALDO ${yearNo} ${ym.replace("-", "")} ${account} ${objectList(series, spec.quoteDims)} ${fmtOre(running)}`,
          );
        }
      }
    }
  }

  if (spec.pbudget) {
    const year = yearOf(0);
    for (const ym of monthsOf(year)) {
      const m = Number(ym.slice(5, 7));
      L.push(`#PBUDGET 0 ${ym.replace("-", "")} 3041 {} ${fmtOre(-(95_000_000 + m * 1_000_000))}`);
      L.push(`#PBUDGET 0 ${ym.replace("-", "")} 7010 {} ${fmtOre(60_000_000)}`);
    }
  }

  for (const yearNo of spec.verYears) {
    for (const v of spec.vouchers.get(yearNo) ?? []) {
      const id = (s: string) => (spec.quoteVerIds ? quote(s) : s);
      L.push(
        `#VER ${id(v.series)} ${id(String(v.verno))} ${sieDate(v.date)} ${quote(v.text)} ${sieDate(v.date)}`,
      );
      L.push("{");
      for (const x of v.rows) {
        const objects = objectList(objectsToSeries(x.objects), spec.quoteDims);
        let tail = "";
        if (x.text) tail = ` ${x.transdate ? sieDate(x.transdate) : '""'} ${quote(x.text)}`;
        else if (x.transdate) tail = ` ${sieDate(x.transdate)}`;
        const body = `${x.account} ${objects} ${fmtOre(x.ore)}${tail}`;
        const label = x.kind === "rtrans" ? "#RTRANS" : x.kind === "btrans" ? "#BTRANS" : "#TRANS";
        L.push(`${spec.transIndent}${label} ${body}`);
        // Backwards compatibility: every #RTRANS is followed by an identical #TRANS.
        if (x.kind === "rtrans") L.push(`${spec.transIndent}#TRANS ${body}`);
      }
      L.push("}");
    }
  }
  return L.join(spec.eol) + spec.eol;
}

// ---------------------------------------------------------------------------
// Truth

type Nested<T> = Record<string, T>;

function kr(ore: number): number {
  return ore === 0 ? 0 : ore / 100;
}

function truthYear(spec: FixtureSpec, year: FiscalYear) {
  const hasData = spec.psaldoYears.includes(year.yearNo) || spec.verYears.includes(year.yearNo);
  const agg = aggregate(hasData ? (spec.vouchers.get(year.yearNo) ?? []) : [], year);
  const accountMonth: Nested<Nested<number>> = {};
  const objectAccountMonth: Nested<Nested<Nested<Nested<number>>>> = {};
  const unallocated: Nested<Nested<number>> = {};
  const resultOre = new Map<string, number>();
  const ccResultOre = new Map<string, Map<string, number>>();
  for (const [account, byMonth] of sortedNum(agg)) {
    if (!isResult(account)) continue;
    for (const [month, bySeries] of sortedStr(byMonth)) {
      const total = bySeries.get("") ?? 0;
      if (total !== 0) {
        (accountMonth[account] ??= {})[month] = kr(total);
        resultOre.set(month, (resultOre.get(month) ?? 0) - total);
      }
      let dim1 = 0;
      for (const [series, ore] of sortedStr(bySeries)) {
        if (series === "" || series.includes(";") || ore === 0) continue;
        const [dim, code] = series.split("|") as [string, string];
        ((objectAccountMonth[dim] ??= {})[code] ??= {})[account] ??= {};
        const target = objectAccountMonth[dim]?.[code]?.[account];
        if (target) target[month] = kr(ore);
        if (dim === "1") {
          dim1 += ore;
          const byMonthCc = ccResultOre.get(code) ?? new Map<string, number>();
          byMonthCc.set(month, (byMonthCc.get(month) ?? 0) - ore);
          ccResultOre.set(code, byMonthCc);
        }
      }
      if (total - dim1 !== 0) (unallocated[account] ??= {})[month] = kr(total - dim1);
    }
  }
  const resultPerMonth: Nested<number> = {};
  for (const [month, ore] of sortedStr(resultOre)) if (ore !== 0) resultPerMonth[month] = kr(ore);
  const costCenterResultPerMonth: Nested<Nested<number>> = {};
  for (const [code, byMonth] of sortedStr(ccResultOre)) {
    for (const [month, ore] of sortedStr(byMonth)) {
      if (ore !== 0) (costCenterResultPerMonth[code] ??= {})[month] = kr(ore);
    }
  }
  const res: Nested<number> = {};
  const allTotals = accountTotals(aggregate(spec.vouchers.get(year.yearNo) ?? [], year));
  for (const [account, ore] of sortedNum(allTotals)) if (isResult(account)) res[account] = kr(ore);

  return {
    yearOffset: year.yearNo,
    start: year.start,
    end: year.end,
    source: spec.psaldoYears.includes(year.yearNo)
      ? "psaldo"
      : spec.verYears.includes(year.yearNo)
        ? "trans"
        : "none",
    resultYtd: kr([...resultOre.values()].reduce((a, b) => a + b, 0)),
    resultPerMonth,
    accountMonth,
    objectAccountMonth,
    costCenterResultPerMonth,
    unallocatedAccountMonth: unallocated,
    res,
  };
}

function truth(spec: FixtureSpec) {
  const written = spec.verYears.flatMap((y) => spec.vouchers.get(y) ?? []);
  const fiscalYears: Nested<{ start: string; end: string }> = {};
  const years: Nested<ReturnType<typeof truthYear>> = {};
  for (const y of spec.years) {
    fiscalYears[y.yearNo] = { start: y.start, end: y.end };
    years[y.yearNo] = truthYear(spec, y);
  }
  return {
    file: spec.file,
    company: spec.company,
    orgNr: spec.orgnr,
    companyName: spec.fnamn,
    encoding: spec.encoding,
    declaredFormat: "PC8",
    psaldoMode: spec.psaldo,
    usedTransFallback: spec.psaldoYears.length === 0 && spec.verYears.length > 0,
    voucherCount: written.length,
    rtransCount: written.flatMap((v) => v.rows).filter((x) => x.kind === "rtrans").length,
    btransCount: written.flatMap((v) => v.rows).filter((x) => x.kind === "btrans").length,
    fiscalYears,
    accounts: Object.fromEntries(Object.entries(spec.accounts)),
    objects: spec.objects,
    years,
  };
}

// ---------------------------------------------------------------------------
// Fixture definitions

const FY2026: FiscalYear = { yearNo: 0, start: "2026-01-01", end: "2026-12-31" };
const FY2025: FiscalYear = { yearNo: -1, start: "2025-01-01", end: "2025-12-31" };
const SEP_2026 = "2026-09";

const MBAB_OPENING: Record<number, number> = {
  1229: -6_000_000,
  1510: 85_000_000,
  1930: 120_000_000,
  2440: -30_000_000,
  2610: -10_000_000,
  2640: 4_000_000,
  2710: -15_000_000,
  2731: -16_000_000,
};

const MBR_OPENING: Record<number, number> = {
  1510: 40_000_000,
  1930: 65_000_000,
  2440: -8_000_000,
  2710: -6_000_000,
};

function mbabVouchers(seed: number, lastMonth = SEP_2026): Map<number, Voucher[]> {
  return new Map([
    [0, generateYear(monthsOf(FY2026, lastMonth), seed, mbabMonth)],
    [-1, generateYear(monthsOf(FY2025), seed + 1, mbabMonth)],
  ]);
}

function specs(): FixtureSpec[] {
  const mbabBase = {
    encoding: "cp437" as const,
    eol: "\r\n" as const,
    transIndent: "\t",
    quoteDims: false,
    quoteVerIds: false,
    fnamn: "Miljonbemanning AB",
    orgnr: "556959-9318",
    company: "MBAB" as const,
    years: [FY2026, FY2025],
    accounts: MBAB_ACCOUNTS,
    dims: { 1: "Kostnadsställe", 6: "Projekt" },
    objects: MBAB_OBJECTS,
    openingBalances: MBAB_OPENING,
    pbudget: false,
  };
  const mbrBase = {
    encoding: "cp437" as const,
    eol: "\r\n" as const,
    transIndent: "   ",
    quoteDims: true,
    quoteVerIds: true,
    fnamn: "Miljonbemanning Restart AB",
    orgnr: "559208-9071",
    company: "MBR" as const,
    accounts: MBR_ACCOUNTS,
    dims: { 1: "Kostnadsställe" },
    objects: MBR_OBJECTS,
    openingBalances: MBR_OPENING,
    pbudget: false,
  };
  const brokenFy0: FiscalYear = { yearNo: 0, start: "2025-05-01", end: "2026-04-30" };
  const brokenFy1: FiscalYear = { yearNo: -1, start: "2024-05-01", end: "2025-04-30" };
  const plainMbr = (r: Rng, ym: string, n: Numbering) => mbrMonth(r, ym, n, false);
  const specialMbr = (r: Rng, ym: string, n: Numbering) => mbrMonth(r, ym, n, true);

  return [
    {
      ...mbabBase,
      file: "mbab_2026_psaldo.se",
      vouchers: mbabVouchers(2026),
      psaldo: "movement",
      psaldoYears: [0, -1],
      verYears: [0],
      pbudget: true,
    },
    {
      ...mbrBase,
      file: "mbr_2026_trans_only.se",
      years: [FY2026, FY2025],
      vouchers: new Map([
        [0, generateYear(monthsOf(FY2026, SEP_2026), 559, specialMbr)],
        [-1, generateYear(monthsOf(FY2025), 558, plainMbr)],
      ]),
      psaldo: "none",
      psaldoYears: [],
      verYears: [0],
    },
    {
      ...mbabBase,
      file: "mbab_2026_cumulative.se",
      vouchers: mbabVouchers(2026),
      psaldo: "cumulative",
      psaldoYears: [0, -1],
      verYears: [],
    },
    {
      ...mbabBase,
      file: "mbab_declared_pc8_but_1252.se",
      encoding: "windows-1252",
      eol: "\n",
      years: [FY2026],
      vouchers: new Map([[0, generateYear(monthsOf(FY2026, SEP_2026), 1252, mbabMonth)]]),
      psaldo: "movement",
      psaldoYears: [0],
      verYears: [],
    },
    {
      ...mbrBase,
      file: "mbr_broken_fy.se",
      years: [brokenFy0, brokenFy1],
      vouchers: new Map([
        [0, generateYear(monthsOf(brokenFy0), 2505, plainMbr)],
        [-1, generateYear(monthsOf(brokenFy1), 2405, plainMbr)],
      ]),
      psaldo: "movement",
      psaldoYears: [0, -1],
      verYears: [],
    },
    {
      ...mbabBase,
      file: "unknown_org.se",
      fnamn: "Exempelbolaget i Söderort AB",
      // Fails the Luhn check, so it can never be a real company's number.
      orgnr: "556677-8890",
      company: null,
      years: [FY2026],
      vouchers: new Map([[0, generateYear(monthsOf(FY2026, "2026-03"), 77, mbabMonth)]]),
      psaldo: "movement",
      psaldoYears: [0],
      verYears: [0],
    },
  ];
}

export function generateSieFixtures(): GeneratedFixture[] {
  const out: GeneratedFixture[] = [];
  for (const spec of specs()) {
    out.push({ path: spec.file, bytes: encode(writeSie(spec), spec.encoding) });
    const json = `${JSON.stringify(truth(spec), null, 2)}\n`;
    out.push({
      path: `truth/${spec.file.replace(/\.se$/, ".json")}`,
      bytes: new TextEncoder().encode(json),
    });
  }
  return out;
}

const SIE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/sie");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of generateSieFixtures()) {
    const target = join(SIE_DIR, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.bytes);
    console.log(`wrote fixtures/sie/${f.path} (${f.bytes.length} bytes)`);
  }
}
