import { describe, expect, it } from "vitest";
import { COMPANY_GROUP } from "@/lib/contracts/metric-query";
import { ReportTemplateSpecSchema, VIZ_LABELS } from "@/lib/contracts/slides";
import { monthRange } from "@/lib/core/month";
import {
  MemoryMetricDataSource,
  catalogAccountGroups,
  catalogDefinitions,
  resolveReport,
  type MemoryFact,
  type MemoryLedgerRow,
} from "@/lib/metrics";
import { buildReportContext, personalDimensionKeys, seededReportDimensions } from "./context";
import { DEFAULT_REPORT_NAME, defaultReportSpec } from "./default-report";

const DEFS = catalogDefinitions();
const DIMS = seededReportDimensions();
const MONTHS = monthRange("2025-01", "2026-09");

const ID = { krom: 1, rom2: 2, ikea: 11, volvo: 12, anna: 21, bo: 22, arbete: 31 };

const fact = (
  uploadId: string,
  metricKey: string,
  company: "MBAB" | "MBR",
  month: string,
  value: number,
  dims: Record<string, number>,
): MemoryFact => ({ uploadId, metricKey, company, month, value, dims });

const facts: MemoryFact[] = MONTHS.flatMap((month, i) => [
  fact("wb", "aktiva_deltagare", "MBR", month, 40 + 3 * i, { verksamhet: ID.krom }),
  fact("wb", "aktiva_deltagare", "MBR", month, 20, { verksamhet: ID.rom2 }),
  fact("wb", "avslutade_deltagare", "MBR", month, 10, { verksamhet: ID.krom }),
  fact("wb", "resultat_deltagare", "MBR", month, 4 + (i % 3), {
    verksamhet: ID.krom,
    resultattyp: ID.arbete,
  }),
  fact("ip", "timmar", "MBAB", month, 900 + 10 * i, { kund: ID.ikea, konsult: ID.anna }),
  fact("ip", "timmar", "MBAB", month, 300, { kund: ID.volvo, konsult: ID.bo }),
]);

const ledger: MemoryLedgerRow[] = MONTHS.flatMap((month, i) => [
  {
    uploadId: "sie-mbab",
    company: "MBAB",
    month,
    account: 3010,
    dimNo: null,
    objectValueId: null,
    amount: -1_000_000 - i * 10_000,
  },
  {
    uploadId: "sie-mbab",
    company: "MBAB",
    month,
    account: 7010,
    dimNo: null,
    objectValueId: null,
    amount: 800_000,
  },
  {
    uploadId: "sie-mbr",
    company: "MBR",
    month,
    account: 3010,
    dimNo: null,
    objectValueId: null,
    amount: -500_000,
  },
  {
    uploadId: "sie-mbr",
    company: "MBR",
    month,
    account: 7010,
    dimNo: null,
    objectValueId: null,
    amount: 450_000,
  },
]);

const source = new MemoryMetricDataSource({
  definitions: DEFS,
  accountGroups: catalogAccountGroups(),
  facts,
  ledger,
  current: ["wb", "ip", "sie-mbab", "sie-mbr"],
  labels: {
    verksamhet: { [ID.krom]: "KROM", [ID.rom2]: "ROM2" },
    kund: { [ID.ikea]: "IKEA", [ID.volvo]: "Volvo" },
    konsult: { [ID.anna]: "1001", [ID.bo]: "1002" },
    resultattyp: { [ID.arbete]: "Arbete" },
  },
});

const context = (src = source) =>
  buildReportContext({
    anchor: "2026-09",
    title: DEFAULT_REPORT_NAME,
    source: src,
    definitions: DEFS,
    dimensions: DIMS,
    now: new Date("2026-10-12T08:00:00Z"),
  });

describe("defaultReportSpec", () => {
  const spec = defaultReportSpec();

  it("is a valid template with the board's standard slides", () => {
    expect(ReportTemplateSpecSchema.parse(spec)).toEqual(spec);
    expect(spec.name).toBe("Styrelserapport");
    expect(spec.slides.map((s) => [s.metricKey, s.viz])).toEqual([
      ["resultat", "stacked_company"],
      ["resultat", "kpi"],
      ["intakter", "line"],
      ["aktiva_deltagare", "kpi"],
      ["aktiva_deltagare", "bar"],
      ["resultatandel", "kpi"],
      ["timmar", "kpi"],
      ["timmar", "toplist"],
      ["konsulter", "kpi"],
    ]);
    expect(new Set(spec.slides.map((s) => s.id)).size).toBe(spec.slides.length);
    expect(spec.slides.every((s) => s.viz in VIZ_LABELS)).toBe(true);
    expect(spec.slides[1]).toMatchObject({ grain: "ytd", compare: "budget" });
  });

  it("never uses a personal dimension and only dimensions the metric has", () => {
    const personal = personalDimensionKeys(DIMS);
    const byKey = new Map(DEFS.map((d) => [d.key, d]));
    for (const s of spec.slides) {
      const def = byKey.get(s.metricKey);
      expect(def, s.metricKey).toBeDefined();
      const used = [...(s.groupBy ? [s.groupBy] : []), ...s.filters.map((f) => f.dimension)];
      for (const key of used) {
        expect(personal.has(key)).toBe(false);
        if (key !== COMPANY_GROUP) expect(def?.dimensions).toContain(key);
      }
    }
  });

  it("can be renamed", () => {
    expect(defaultReportSpec("Kvartalsrapport").name).toBe("Kvartalsrapport");
  });

  it("resolves against the in-memory source", async () => {
    const report = await resolveReport(spec, context());
    expect(report).toMatchObject({
      schemaVersion: 1,
      title: "Styrelserapport",
      anchorMonth: "2026-09",
      periodLabel: "september 2026",
      generatedAt: "2026-10-12T08:00:00.000Z",
    });
    expect(report.slides.map((s) => s.id)).toEqual(spec.slides.map((s) => s.id));
    for (const s of report.slides) {
      expect(s.headline).toMatch(/^[^a-zåäö]+\.$/);
      expect(s.notes.length).toBeGreaterThan(0);
    }
    const byId = Object.fromEntries(report.slides.map((s) => [s.id, s]));
    // 2026-09 is the 21st month: KROM 40 + 3 × 20, ROM2 20.
    expect(byId["aktiva-deltagare"]?.number?.value).toBe(120);
    expect(byId["aktiva-deltagare"]?.headline).toBe("DELTAGARNA ÖKAR.");
    expect(byId["resultat-per-bolag"]?.chart?.series.map((x) => x.label)).toEqual([
      "MB AB",
      "MB Restart",
    ]);
    expect(byId["deltagare-per-verksamhet"]?.chart?.categories).toEqual(["KROM", "ROM2"]);
    expect(byId["timmar-per-kund"]?.chart?.categories).toEqual(["IKEA", "Volvo"]);
    expect(byId["konsulter-i-arbete"]?.number?.value).toBe(2);
    // No customer, program or other label may leak a consultant id into board output.
    expect(JSON.stringify(report)).not.toMatch(/100[12]/);
  });

  it("resolves without data: every slide says so instead of failing", async () => {
    const empty = new MemoryMetricDataSource({
      definitions: DEFS,
      accountGroups: catalogAccountGroups(),
      current: [],
    });
    const report = await resolveReport(spec, context(empty));
    expect(report.slides).toHaveLength(spec.slides.length);
    for (const s of report.slides) expect(s.number?.value ?? null).toBeNull();
  });
});
