import { describe, expect, it } from "vitest";
import {
  UploadCreateSchema,
  type FactRow,
  type IngestResult,
  type LedgerRow,
} from "@/lib/contracts";
import { formatNumber } from "@/lib/core/format-sv";
import { jsonBytes, STAGE_MAX_BYTES } from "./chunking";
import {
  REPORT_MAX_ISSUES,
  REPORT_MAX_SKIPPED,
  buildUploadCreate,
  compactParseReport,
  factChunks,
  ledgerChunks,
  stageTotal,
} from "./upload-payload";

const base: IngestResult = {
  engineVersion: 1,
  datasetKey: "ip_timmar",
  scenario: "utfall",
  file: { name: "timmar.xlsx", sha256: "a".repeat(64), size: 1234 },
  contentHash: "b".repeat(64),
  companies: ["MBAB"],
  slices: [{ company: "MBAB", month: "2026-09" }],
  facts: [],
  report: { rowsRead: 3, rowsUsed: 2, skipped: [], issues: [], warnings: [] },
  totals: [{ metricKey: "timmar", company: "MBAB", month: "2026-09", value: 16 }],
};

const ledgerRow = (i: number): LedgerRow => ({
  company: "MBAB",
  month: "2026-09",
  account: 3000 + (i % 900),
  dimNo: i % 2 ? 1 : null,
  objectCode: i % 2 ? "100" : null,
  amount: -i,
  yearOffset: 0,
  source: "psaldo",
});

describe("compactParseReport", () => {
  const big: IngestResult["report"] = {
    rowsRead: 50_000,
    rowsUsed: 20_000,
    skipped: Array.from({ length: 30_000 }, (_, i) => ({
      sourceRow: i + 2,
      reason: "filtered" as const,
      detail: `Makulerad – Anna Andersson ${i}`,
    })),
    issues: Array.from({ length: 5000 }, (_, i) => ({
      sourceRow: i + 2,
      column: "timmar",
      value: `åtta och en halv ${i}`,
      message: "Kunde inte läsas som timmar.",
      severity: "error" as const,
    })),
    warnings: ["Okända värden för kund: X."],
    sheet: "Rapport",
  };

  it("keeps a 50 000-row file's upload header well inside one Server Action request", () => {
    const header = buildUploadCreate({ ...base, report: big }, null);
    expect(jsonBytes(header)).toBeLessThan(STAGE_MAX_BYTES);
    expect(UploadCreateSchema.safeParse(header).success).toBe(true);
  });

  it("drops cell values and skip details and says that the lists were cut", () => {
    const r = compactParseReport(big);
    expect(r.skipped).toHaveLength(REPORT_MAX_SKIPPED);
    expect(r.issues).toHaveLength(REPORT_MAX_ISSUES);
    expect(r.skipped.some((s) => "detail" in s)).toBe(false);
    expect(r.issues.every((i) => i.value === "")).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Anna Andersson");
    expect(r.warnings.at(-1)).toBe(
      `Rapporten sparar de första exemplen av ${formatNumber(30_000)} rader som inte räknades och ${formatNumber(5000)} celler som inte kunde läsas.`,
    );
    expect(r).toMatchObject({ rowsRead: 50_000, rowsUsed: 20_000, sheet: "Rapport" });
  });

  it("leaves a small report's numbers and warnings as they are", () => {
    expect(compactParseReport(base.report)).toEqual(base.report);
  });
});

describe("buildUploadCreate", () => {
  it("builds a valid staged upload header for a table result", () => {
    const u = buildUploadCreate(base, { id: "6f1c2b8e-1d2a-4c3b-9e4f-0a1b2c3d4e5f", version: 3 });
    expect(UploadCreateSchema.parse(u)).toMatchObject({
      datasetKey: "ip_timmar",
      templateId: "6f1c2b8e-1d2a-4c3b-9e4f-0a1b2c3d4e5f",
      templateVersion: 3,
      fileSha256: "a".repeat(64),
      asOfDate: null,
      slices: [{ company: "MBAB", month: "2026-09", priority: 0 }],
    });
  });

  it("keeps slice priorities and the export date (SIE without template)", () => {
    const u = buildUploadCreate(
      {
        ...base,
        datasetKey: "fx_bokforing",
        asOfDate: "2026-10-05",
        slices: [
          { company: "MBAB", month: "2025-12", priority: -1 },
          { company: "MBAB", month: "2026-01", priority: 0 },
        ],
      },
      null,
    );
    expect(u).toMatchObject({ templateId: null, templateVersion: null, asOfDate: "2026-10-05" });
    expect(u.slices.map((s) => s.priority)).toEqual([-1, 0]);
  });
});

describe("chunks", () => {
  it("keeps every fact chunk below the request size", () => {
    const facts: FactRow[] = Array.from({ length: 6000 }, (_, i) => ({
      metricKey: "timmar",
      company: "MBAB",
      month: "2026-09",
      dims: { kund: 1 + (i % 50), konsult: 100 + i },
      value: 8,
      sourceRows: [i + 2, i + 3, i + 4],
    }));
    const chunks = factChunks(facts);
    expect(chunks.flat()).toHaveLength(6000);
    for (const c of chunks) expect(jsonBytes(c)).toBeLessThan(STAGE_MAX_BYTES + 10);
  });

  it("sends account and object names with the first ledger chunk only", () => {
    const ledger = {
      rows: Array.from({ length: 4500 }, (_, i) => ledgerRow(i)),
      accounts: [{ company: "MBAB" as const, account: 3010, name: "Försäljning" }],
      objects: [{ company: "MBAB" as const, dimNo: 1, code: "100", name: "Stockholm" }],
      checks: {} as never,
    };
    const chunks = ledgerChunks(ledger);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.rows)).toHaveLength(4500);
    expect(chunks[0]?.accounts).toHaveLength(1);
    expect(chunks.slice(1).every((c) => c.accounts.length === 0 && c.objects.length === 0)).toBe(
      true,
    );
    expect(ledgerChunks({ ...ledger, rows: [] })).toEqual([
      { rows: [], accounts: ledger.accounts, objects: ledger.objects },
    ]);
    expect(ledgerChunks({ ...ledger, rows: [], accounts: [], objects: [] })).toEqual([]);
  });

  it("counts the rows to stage", () => {
    expect(stageTotal(base, [{} as FactRow, {} as FactRow])).toBe(2);
    expect(
      stageTotal(
        {
          ...base,
          ledger: { rows: [ledgerRow(1)], accounts: [], objects: [], checks: {} as never },
        },
        null,
      ),
    ).toBe(1);
  });
});
