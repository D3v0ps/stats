import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { FactDraftSchema, ImportTemplateSchema, type ImportTemplate } from "@/lib/contracts";
import { CATALOG_ACCOUNT_GROUPS, CATALOG_DATASETS, CATALOG_METRICS } from "@/lib/contracts/catalog";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FILES = join(ROOT, "fixtures/files");
const TRUTH = join(ROOT, "fixtures/truth");

const EXPECTED_FILES = [
  "budget_2026.xlsx",
  "fortnox_kundforsaljning_MBAB_2026.xlsx",
  "intelliplan_fakturering_MBAB_2026-09.xlsx",
  "intelliplan_franvaro_MBAB_2026-09.csv",
  "intelliplan_konsulter_MBAB.xlsx",
  "intelliplan_kundlista.xls",
  "intelliplan_timmar_MBAB_2026-08.xlsx",
  "intelliplan_timmar_MBAB_2026-09.xlsx",
  "intelliplan_timmar_MBAB_2026-09_andrad.xlsx",
  "intelliplan_timmar_MBAB_2026-09_utf16.csv",
  "workbuster_deltagare_MBAB.xlsx",
  "workbuster_deltagare_MBR.xlsx",
  "workbuster_ordrar_MBAB.xlsx",
];

interface SheetLayout {
  sheet: string;
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  dataRows: number;
  sumRows: number[];
  footerRows: number[];
  merges: string[];
}

interface Entry {
  file: string;
  truth: string;
  format: "xlsx" | "csv" | "xls-html";
  datasetKey: string | null;
  kind: "table" | "cases" | "reference";
  companies: string[];
  scenario: "utfall" | "budget";
  months: string[];
  choices: { month?: string; company?: string; asOfDate?: string };
  encoding?: string;
  layout: SheetLayout[] | { headerLine: number; dataLines: number };
  aliases: Record<string, Record<string, string>>;
  templates: unknown[];
  sameTruthAs?: string;
  drift?: { fromTemplateOf: string; added: string[]; removed: string[] };
  reconcileConfig: string;
  counts: Record<string, number>;
}

const TruthFactSchema = FactDraftSchema.omit({ sourceRows: true }).strict();
type TruthFact = ReturnType<typeof TruthFactSchema.parse>;

const manifest = JSON.parse(readFileSync(join(TRUTH, "manifest.json"), "utf8")) as {
  files: Entry[];
};
const entries = manifest.files;
const entry = (file: string): Entry => {
  const found = entries.find((e) => e.file === file);
  if (!found) throw new Error(`No manifest entry for ${file}`);
  return found;
};
const readTruth = (file: string): TruthFact[] =>
  (JSON.parse(readFileSync(join(TRUTH, entry(file).truth), "utf8")) as unknown[]).map((f) =>
    TruthFactSchema.parse(f),
  );
const factKey = (f: TruthFact) =>
  JSON.stringify([f.metricKey, f.company, f.month, Object.entries(f.dims).sort()]);
const sum = (facts: TruthFact[], metricKey: string) =>
  facts.filter((f) => f.metricKey === metricKey).reduce((s, f) => s + f.value, 0);
const normalizeHeader = (h: unknown) =>
  String(h ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function readSheetRows(file: string, sheet?: string): unknown[][] {
  const wb = XLSX.read(readFileSync(join(FILES, file)), { type: "buffer" });
  const ws = wb.Sheets[sheet ?? wb.SheetNames[0] ?? ""];
  if (!ws) throw new Error(`${file}: sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: true });
}

function headerCells(e: Entry, sheet?: SheetLayout): string[] {
  const bytes = readFileSync(join(FILES, e.file));
  if (e.format === "xlsx") {
    const layout = sheet ?? (e.layout as SheetLayout[])[0];
    if (!layout) throw new Error(`${e.file}: no layout`);
    const row = readSheetRows(e.file, layout.sheet)[layout.headerRow - 1] ?? [];
    return row.map(normalizeHeader);
  }
  const text =
    e.encoding === "utf-16le"
      ? new TextDecoder("utf-16le").decode(bytes.subarray(2))
      : new TextDecoder("windows-1252").decode(bytes);
  const first = text.split(/\r?\n/)[0] ?? "";
  return first.split(first.includes("\t") ? "\t" : ";").map(normalizeHeader);
}

describe("fixture files", () => {
  it("contains exactly the expected files, each listed once in the manifest", () => {
    expect(readdirSync(FILES).sort()).toEqual([...EXPECTED_FILES].sort());
    expect(entries.map((e) => e.file).sort()).toEqual([...EXPECTED_FILES].sort());
  });

  it("has a truth file for every fixture and nothing else in fixtures/truth", () => {
    const truthFiles = readdirSync(TRUTH).sort();
    expect(truthFiles).toEqual([...entries.map((e) => e.truth), "manifest.json"].sort());
    for (const e of entries) expect(e.truth).toBe(e.file.replace(/\.[^.]+$/, ".json"));
  });

  it("has a reconcile config for every fixture", () => {
    for (const e of entries) {
      expect(existsSync(join(ROOT, "scripts/reconcile/configs", e.reconcileConfig))).toBe(true);
    }
  });

  it.each(EXPECTED_FILES)("%s has the bytes of its declared format", (file) => {
    const e = entry(file);
    const bytes = readFileSync(join(FILES, file));
    expect(bytes.length).toBeGreaterThan(500);
    if (e.format === "xlsx")
      expect(bytes.subarray(0, 4)).toEqual(Buffer.from("PK\x03\x04", "latin1"));
    if (e.format === "xls-html") expect(bytes.toString("utf8", 0, 5)).toBe("<html");
    if (e.encoding === "utf-16le") expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
    if (e.encoding === "windows-1252") {
      // åäö as single bytes, so the file is not valid UTF-8.
      expect(bytes.includes(0xe5) || bytes.includes(0xe4) || bytes.includes(0xf6)).toBe(true);
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toThrow();
    }
  });

  it("timmar xlsx: merged title, header on row 4, Totalt row and footer", () => {
    const e = entry("intelliplan_timmar_MBAB_2026-09.xlsx");
    const layout = (e.layout as SheetLayout[])[0];
    const rows = readSheetRows(e.file);
    expect(layout?.headerRow).toBe(4);
    expect(layout?.merges).toEqual(["A1:H1"]);
    expect(String(rows[1]?.[0])).toBe("Period: 2026-09-01 - 2026-09-30");
    expect(String(rows[2]?.[0])).toBe("Miljonbemanning AB");
    const totalRow = rows[(layout?.sumRows[0] ?? 0) - 1] ?? [];
    expect(totalRow[0]).toBe("Totalt");
    const footer = rows[(layout?.footerRows[0] ?? 0) - 1] ?? [];
    expect(footer[0]).toBe("Utskrivet 2026-10-01 08:12");
    expect(footer[7]).toBe("Sida 1 av 1");
    // The printed total includes rows the mapping filters out, so it must exceed the truth.
    expect(Number(totalRow[6])).toBeGreaterThan(sum(readTruth(e.file), "timmar"));
  });

  it("timmar xlsx mixes numeric and text hours and dates", () => {
    const rows = readSheetRows("intelliplan_timmar_MBAB_2026-09.xlsx").slice(4);
    const hours = rows.map((r) => r[6]).filter((v) => v !== undefined && v !== null);
    const dates = rows.map((r) => r[5]).filter((v) => v !== undefined && v !== null);
    expect(hours.some((v) => typeof v === "number")).toBe(true);
    expect(hours.some((v) => typeof v === "string" && /^\d+,\d+$/.test(v))).toBe(true);
    expect(hours.some((v) => typeof v === "string" && / h$/.test(v))).toBe(true);
    expect(dates.some((v) => typeof v === "number")).toBe(true);
    expect(dates.some((v) => typeof v === "string" && /^\d{1,2}\/9 2026$/.test(v))).toBe(true);
    const kunder = new Set(rows.map((r) => r[0]));
    for (const k of ["Postnord", "PostNord AB", "Miljonbemanning Presentation (Stockholm)"]) {
      expect(kunder.has(k)).toBe(true);
    }
    expect(rows.some((r) => r[3] === "Okänd arbetstagare" && r[2] === undefined)).toBe(true);
  });

  it("budget xlsx: one sheet per company, months Jan..Dec plus Helår, costs negative", () => {
    const rows = readSheetRows("budget_2026.xlsx", "MB Restart");
    const header = rows[4] ?? [];
    expect(header.slice(1, 14)).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Maj",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Okt",
      "Nov",
      "Dec",
      "Helår",
    ]);
    const personal = rows.find((r) => r[0] === "Personalkostnader") ?? [];
    expect(Number(personal[1])).toBeLessThan(0);
    const wb = XLSX.read(readFileSync(join(FILES, "budget_2026.xlsx")), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["MB AB", "MB Restart"]);
    expect(wb.Sheets["MB AB"]?.N6?.f).toBe("SUM(B6:M6)");
  });

  it("kundlista .xls is an HTML table with entity-encoded åäö", () => {
    const html = readFileSync(join(FILES, "intelliplan_kundlista.xls"), "utf8");
    expect(html).toContain("<th>Kundnummer</th><th>Kundnamn</th><th>Arbetsst&auml;lle</th>");
    expect(html).toContain("Budbee S&ouml;dert&auml;lje");
    expect(html).toContain("<td>Postnord</td>");
  });
});

describe("truth", () => {
  it.each(EXPECTED_FILES)("%s: facts parse and match the catalog", (file) => {
    const e = entry(file);
    const facts = readTruth(file);
    if (e.kind === "reference") {
      expect(facts).toEqual([]);
      return;
    }
    expect(facts.length).toBeGreaterThan(0);
    const dataset = CATALOG_DATASETS.find((d) => d.key === e.datasetKey);
    expect(dataset).toBeDefined();
    const dimsByMetric = new Map<string, string>();
    const keys = new Set<string>();
    for (const f of facts) {
      const metric = CATALOG_METRICS.find((m) => m.key === f.metricKey);
      expect(metric?.datasetKey).toBe(e.datasetKey);
      expect(e.companies).toContain(f.company);
      expect(Number.isFinite(f.value)).toBe(true);
      if (f.value === 0) expect(f.metricKey).toBe("anstallningstid");
      for (const dim of Object.keys(f.dims)) expect(dataset?.dimensions).toContain(dim);
      // Every fact of a metric carries the same mapped dimensions.
      const dimSet = Object.keys(f.dims).sort().join(",");
      expect(dimsByMetric.get(f.metricKey) ?? dimSet).toBe(dimSet);
      dimsByMetric.set(f.metricKey, dimSet);
      keys.add(factKey(f));
    }
    expect(keys.size).toBe(facts.length);
    expect([...new Set(facts.map((f) => f.month))].sort()).toEqual(e.months);
  });

  it("never contains personnummer, names or unstaffed/test rows", () => {
    for (const e of entries) {
      const text = readFileSync(join(TRUTH, e.truth), "utf8");
      expect(text).not.toMatch(/\b(\d{2})?\d{6}[-+]?\d{4}\b/);
      expect(text).not.toContain("Okänd arbetstagare");
      expect(text).not.toContain("Presentation");
      for (const f of readTruth(e.file)) {
        if ("konsult" in f.dims) expect(f.dims.konsult).toMatch(/^\d{4}$/);
      }
    }
  });

  it("timmar: canonical customers, constant verksamhet, whole shifts", () => {
    for (const file of [
      "intelliplan_timmar_MBAB_2026-09.xlsx",
      "intelliplan_timmar_MBAB_2026-08.xlsx",
    ]) {
      const facts = readTruth(file);
      const kunder = new Set(facts.map((f) => f.dims.kund));
      expect(kunder.has("PostNord AB")).toBe(true);
      expect(kunder.has("Postnord")).toBe(false);
      expect(kunder.size).toBe(7);
      expect(new Set(facts.map((f) => f.dims.verksamhet))).toEqual(new Set(["Bemanning"]));
      expect(
        facts.filter((f) => f.metricKey === "pass").every((f) => Number.isInteger(f.value)),
      ).toBe(true);
      expect(sum(facts, "pass")).toBe(entry(file).counts.includedShifts);
    }
  });

  it("files with the same data share an identical truth", () => {
    for (const e of entries.filter((x) => x.sameTruthAs)) {
      expect(readTruth(e.file)).toEqual(readTruth(e.sameTruthAs ?? ""));
    }
  });

  it("frånvaro: only sick leave, counted per row", () => {
    const facts = readTruth("intelliplan_franvaro_MBAB_2026-09.csv");
    expect(new Set(facts.map((f) => f.dims.franvarotyp))).toEqual(new Set(["SJUK LO", "SJUK UNI"]));
    const e = entry("intelliplan_franvaro_MBAB_2026-09.csv");
    expect(sum(facts, "sjukpass")).toBe(
      (e.counts.absenceRows ?? 0) - (e.counts.filteredOlovligFranvaro ?? 0),
    );
  });

  it("cases: Workbuster months 2025-01..2026-09, results typed, tenure only with actives", () => {
    for (const company of ["MBAB", "MBR"]) {
      const facts = readTruth(`workbuster_deltagare_${company}.xlsx`);
      const months = [...new Set(facts.map((f) => f.month))].sort();
      expect(months[0]).toBe("2025-01");
      expect(months[months.length - 1]).toBe("2026-09");
      const results = facts.filter((f) => f.metricKey === "resultat_deltagare");
      expect(new Set(results.map((f) => f.dims.resultattyp))).toEqual(
        new Set(["Arbete", "Studier"]),
      );
      expect(
        facts
          .filter((f) => f.metricKey !== "resultat_deltagare")
          .every((f) => !("resultattyp" in f.dims)),
      ).toBe(true);
      // Interruptions are a subset of endings in the same month and group.
      const ended = new Map(
        facts
          .filter((f) => f.metricKey === "avslutade_deltagare")
          .map((f) => [factKey({ ...f, metricKey: "" }), f.value]),
      );
      for (const f of facts.filter((x) => x.metricKey === "avbrott_deltagare")) {
        expect(f.value).toBeLessThanOrEqual(ended.get(factKey({ ...f, metricKey: "" })) ?? 0);
      }
    }
    const konsulter = readTruth("intelliplan_konsulter_MBAB.xlsx");
    const active = new Set(
      konsulter
        .filter((f) => f.metricKey === "anstallda_konsulter")
        .map((f) => factKey({ ...f, metricKey: "" })),
    );
    const tenure = konsulter.filter((f) => f.metricKey === "anstallningstid");
    expect(new Set(tenure.map((f) => factKey({ ...f, metricKey: "" })))).toEqual(active);
    expect(konsulter[0]?.month).toBe("2023-01");
  });

  it("budget: every kontogrupp key x month x company, in ledger sign", () => {
    const facts = readTruth("budget_2026.xlsx");
    expect(facts).toHaveLength(2 * 12 * 6);
    const groupKeys = new Set(CATALOG_ACCOUNT_GROUPS.map((g) => g.key));
    for (const f of facts) {
      expect(f.metricKey).toBe("budget_belopp");
      expect(groupKeys.has(f.dims.kontogrupp ?? "")).toBe(true);
      const isRevenue = f.dims.kontogrupp === "intakter";
      expect(isRevenue ? f.value < 0 : f.value > 0).toBe(true);
    }
  });

  it("fortnox: credit notes reduce totals, Arbetsförmedlingen is a customer", () => {
    const facts = readTruth("fortnox_kundforsaljning_MBAB_2026.xlsx");
    expect(new Set(facts.map((f) => f.dims.kund))).toContain("Arbetsförmedlingen");
    expect(new Set(facts.map((f) => f.dims.kund))).not.toContain("Postnord");
    expect(entry("fortnox_kundforsaljning_MBAB_2026.xlsx").counts.creditNotes).toBeGreaterThan(0);
  });
});

describe("templates in the manifest", () => {
  it.each(EXPECTED_FILES)("%s: templates are valid ImportTemplates for the dataset", (file) => {
    const e = entry(file);
    const templates: ImportTemplate[] = e.templates.map((t) => ImportTemplateSchema.parse(t));
    expect(templates.length).toBe(e.kind === "reference" ? 0 : file === "budget_2026.xlsx" ? 2 : 1);
    const dataset = CATALOG_DATASETS.find((d) => d.key === e.datasetKey);
    const datasetMetrics = new Set(
      CATALOG_METRICS.filter((m) => m.datasetKey === e.datasetKey).map((m) => m.key),
    );
    for (const t of templates) {
      expect(t.datasetKey).toBe(e.datasetKey);
      const cfg = t.config;
      if (cfg.kind === "sie") throw new Error("unexpected sie template");
      expect(cfg.kind).toBe(e.kind);
      for (const c of cfg.columns) {
        if (c.metricKey) expect(datasetMetrics.has(c.metricKey)).toBe(true);
        if (c.dimensionKey) expect(dataset?.dimensions).toContain(c.dimensionKey);
        if (c.column === "personnummer" || c.column === "namn" || c.column === "konsult") {
          expect(c.keep).toBe(false);
        }
      }
      if (cfg.kind === "table") {
        for (const counter of cfg.counters)
          expect(datasetMetrics.has(counter.metricKey)).toBe(true);
        expect(cfg.scenario).toBe(e.scenario);
      } else {
        for (const key of Object.values(cfg.cases.metrics))
          expect(datasetMetrics.has(key)).toBe(true);
      }
      // The signature is exactly the file's (normalized) header row.
      const layouts = Array.isArray(e.layout) ? e.layout : [];
      const layout = t.sheetHint ? layouts.find((l) => l.sheet === t.sheetHint) : layouts[0];
      expect(headerCells(e, layout)).toEqual(t.headerSignature);
    }
  });

  it("the drifted file differs from the v1 signature by one rename and one new column", () => {
    const e = entry("intelliplan_timmar_MBAB_2026-09_andrad.xlsx");
    const v1 = ImportTemplateSchema.parse(entry(e.drift?.fromTemplateOf ?? "").templates[0]);
    const now = headerCells(e);
    expect(now.filter((h) => !v1.headerSignature.includes(h)).sort()).toEqual(
      [...(e.drift?.added ?? [])].sort(),
    );
    expect(v1.headerSignature.filter((h) => !now.includes(h))).toEqual(e.drift?.removed);
  });
});

describe("generator", () => {
  it("regenerates byte-identical files and truth", { timeout: 120_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), "mb-fixtures-"));
    try {
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          "scripts/fixtures/generate.ts",
          "--out",
          out,
        ],
        { cwd: ROOT, stdio: "pipe" },
      );
      for (const dir of ["files", "truth"]) {
        const committed = readdirSync(join(ROOT, "fixtures", dir)).sort();
        expect(readdirSync(join(out, dir)).sort()).toEqual(committed);
        for (const name of committed) {
          const same = readFileSync(join(out, dir, name)).equals(
            readFileSync(join(ROOT, "fixtures", dir, name)),
          );
          expect(same, `${dir}/${name} is stale: run pnpm fixtures`).toBe(true);
        }
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
