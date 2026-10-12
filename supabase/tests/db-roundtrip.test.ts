// SQL and the TypeScript reference agree: the synthetic fixtures (and one SIE file) go through
// the app's ingest and the repo functions (createUpload, stageFacts / stageLedger,
// publishUpload) into the migrated database as an allowlisted user. Then a matrix of metric
// queries runs through runMetricQuery twice, over SupabaseMetricDataSource (the SQL RPCs) and
// over MemoryMetricDataSource built from the same facts, and the results must be identical
// (numbers to float noise: SQL sums numeric exactly, TypeScript in doubles).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CompanyFilter,
  FactDraft,
  FactRow,
  IngestResult,
  MetricQuery,
  MetricQueryResult,
  UploadCreate,
} from "@/lib/contracts";
import { MetricQuerySchema } from "@/lib/contracts/metric-query";
import { factsContentHash, resolveDims } from "@/lib/ingest";
import { runMetricQuery } from "@/lib/metrics/engine";
import {
  MemoryMetricDataSource,
  type MemoryFact,
  type MemoryLedgerRow,
  type MemorySlice,
} from "@/lib/metrics/memory-source";
import {
  ensureDimensionValues,
  listAccountGroups,
  listDimensionValues,
  listMetricDefinitions,
  loadDimensionDictionary,
} from "@/lib/db/repo/catalog";
import { SupabaseMetricDataSource } from "@/lib/db/repo/metrics";
import type { DbClient } from "@/lib/db/repo/shared";
import {
  createUpload,
  kostnadsstalleCode,
  listUploads,
  publishUpload,
  stageFacts,
  stageLedger,
} from "@/lib/db/repo/uploads";
import { ingestSie } from "@/lib/sie";
import {
  SIE_FIXTURES,
  ingestFixture,
  manifestEntry,
  readTruth,
} from "../../tests/integration/manifest";
import { createAppUser, createTestDb, type Db } from "./harness";
import { pgClient } from "./pg-client";

const TABLE_FILES = [
  "intelliplan_timmar_MBAB_2026-08.xlsx",
  "intelliplan_timmar_MBAB_2026-09.xlsx",
  "intelliplan_franvaro_MBAB_2026-09.csv",
  "intelliplan_fakturering_MBAB_2026-09.xlsx",
  "intelliplan_konsulter_MBAB.xlsx",
  "workbuster_deltagare_MBAB.xlsx",
  "workbuster_deltagare_MBR.xlsx",
  "budget_2026.xlsx",
];
const SIE_FILE = "mbab_2026_psaldo.se";

const METRICS = [
  "timmar",
  "konsulter",
  "sjukfranvaro",
  "faktor",
  "aktiva_deltagare",
  "resultatandel",
  "anstallningstid",
  "intakter",
  "resultat",
  "kostnader",
];

/** One upload per file: a file read with several templates (one per sheet) is one upload. */
function mergeResults(results: IngestResult[]): IngestResult {
  const [first, ...rest] = results;
  if (!first) throw new Error("no results");
  return {
    ...first,
    companies: [...new Set(results.flatMap((r) => r.companies))],
    slices: results.flatMap((r) => r.slices),
    facts: results.flatMap((r) => r.facts),
    totals: results.flatMap((r) => r.totals),
    report: rest.length === 0 ? first.report : { ...first.report, sheet: undefined },
  };
}

function uploadCreate(r: IngestResult): UploadCreate {
  return {
    datasetKey: r.datasetKey,
    templateId: null,
    templateVersion: null,
    scenario: r.scenario,
    fileName: r.file.name,
    fileSha256: r.file.sha256,
    fileSize: r.file.size,
    contentHash: r.contentHash,
    engineVersion: r.engineVersion,
    asOfDate: r.asOfDate ?? null,
    slices: r.slices.map((s) => ({ ...s, priority: s.priority ?? 0 })),
    parseReport: r.report,
    totals: r.totals,
  };
}

/** Labels to ids the way review does it: auto_create values are created, asked ones confirmed. */
async function resolveFacts(client: DbClient, facts: FactDraft[]): Promise<FactRow[]> {
  const first = resolveDims(facts, await loadDimensionDictionary(client));
  if (first.rows) return first.rows;
  for (const [dim, labels] of Object.entries(first.unknown)) {
    await ensureDimensionValues(client, dim, labels, { force: true });
  }
  const second = resolveDims(facts, await loadDimensionDictionary(client));
  if (!second.rows) throw new Error(`Unresolved labels: ${JSON.stringify(second.unknown)}`);
  return second.rows;
}

/** Paths where two values differ; numbers may differ by float noise only. */
function differences(a: unknown, b: unknown, path = "$", out: string[] = []): string[] {
  if (typeof a === "number" && typeof b === "number") {
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    if (!(Math.abs(a - b) <= 1e-9 * scale)) out.push(`${path}: ${a} != ${b}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} != ${b.length}`);
    a.forEach((v, i) => differences(v, b[i], `${path}[${i}]`, out));
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      differences(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
        out,
      );
    }
    return out;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return out;
}

describe("database round trip: SQL RPCs = in-memory reference", () => {
  let db: Db;
  let client: DbClient;
  let sql: SupabaseMetricDataSource;
  let memory: MemoryMetricDataSource;
  const valueIds: Record<string, Record<string, number>> = {};

  beforeAll(async () => {
    db = await createTestDb();
    client = pgClient(db, await createAppUser(db));

    const facts: MemoryFact[] = [];
    const ledger: MemoryLedgerRow[] = [];
    const slices: MemorySlice[] = [];
    const scenarios: Record<string, "utfall" | "budget"> = {};
    const published: string[] = [];

    for (const file of TABLE_FILES) {
      const merged = mergeResults(await ingestFixture(manifestEntry(file)));
      const rows = await resolveFacts(client, merged.facts);
      const result = { ...merged, contentHash: await factsContentHash(merged.facts) };
      const id = await createUpload(client, uploadCreate(result));
      await stageFacts(client, id, rows);
      await publishUpload(client, id);
      published.push(id);
      scenarios[id] = result.scenario;
      for (const r of rows) facts.push({ ...r, uploadId: id });
      for (const s of result.slices)
        slices.push({ ...s, uploadId: id, datasetKey: result.datasetKey });
    }

    const bytes = new Uint8Array(readFileSync(join(SIE_FIXTURES, SIE_FILE)));
    const sie = await ingestSie(bytes, SIE_FILE);
    const sieLedger = sie.ledger!;
    const sieId = await createUpload(client, uploadCreate(sie));
    await stageLedger(client, sieId, sieLedger);
    await publishUpload(client, sieId);
    published.push(sieId);
    for (const s of sie.slices) slices.push({ ...s, uploadId: sieId, datasetKey: sie.datasetKey });

    const values = await listDimensionValues(client, { includeInactive: true });
    const labels: Record<string, Record<number, string>> = {};
    const codes: Record<string, Record<number, string>> = {};
    for (const v of values) {
      (labels[v.dimensionKey] ??= {})[v.id] = v.label;
      (codes[v.dimensionKey] ??= {})[v.id] = v.code;
      (valueIds[v.dimensionKey] ??= {})[v.code] = v.id;
    }
    const kostnadsstalle = new Map(
      values
        .filter((v) => v.dimensionKey === "kostnadsstalle")
        .map((v) => [v.code.toLowerCase(), v.id]),
    );
    for (const r of sieLedger.rows) {
      // Only kostnadsställe objects (SIE dimension 1) are stored, like stageLedger does.
      if (r.dimNo !== null && r.dimNo !== 1) continue;
      const objectValueId =
        r.dimNo === null
          ? null
          : kostnadsstalle.get(kostnadsstalleCode(r.company, r.objectCode!).toLowerCase());
      if (objectValueId === undefined) throw new Error(`no kostnadsställe ${r.objectCode}`);
      ledger.push({
        uploadId: sieId,
        company: r.company,
        month: r.month,
        account: r.account,
        dimNo: r.dimNo,
        objectValueId,
        amount: r.amount,
        yearOffset: r.yearOffset,
      });
    }

    const uploads = await listUploads(client, { ids: published });
    memory = new MemoryMetricDataSource({
      definitions: await listMetricDefinitions(client),
      accountGroups: await listAccountGroups(client),
      facts,
      ledger,
      current: published,
      scenarios,
      slices,
      labels,
      codes,
      fiscalStartMonth: 1,
      uploadTimes: Object.fromEntries(uploads.map((u) => [u.id, u.publishedAt ?? ""])),
    });
    sql = new SupabaseMetricDataSource(client);
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  const run = async (input: Partial<MetricQuery>) => {
    const query = MetricQuerySchema.parse({
      metricKeys: METRICS,
      period: { grain: "month", anchor: "2026-09" },
      company: "ALL",
      compare: ["prev_period", "prev_year", "budget"],
      series: "window",
      ...input,
    });
    const [fromSql, fromMemory] = await Promise.all([
      runMetricQuery(query, sql),
      runMetricQuery(query, memory),
    ]);
    return { fromSql, fromMemory };
  };
  const statuses = (r: MetricQueryResult) =>
    Object.fromEntries(r.results.map((m) => [m.metricKey, m.status]));

  it("loads real data: SQL totals match the fixture truth", async () => {
    const { fromSql } = await run({ company: "MBAB" });
    const byKey = Object.fromEntries(fromSql.results.map((m) => [m.metricKey, m]));
    const truthSum = (file: string, metric: string, month: string, company = "MBAB") =>
      readTruth(manifestEntry(file))
        .filter((f) => f.metricKey === metric && f.month === month && f.company === company)
        .reduce((a, f) => a + f.value, 0);
    expect(byKey.timmar?.total.value).toBeCloseTo(
      truthSum("intelliplan_timmar_MBAB_2026-09.xlsx", "timmar", "2026-09"),
      6,
    );
    expect(byKey.timmar?.total.compare.prev_period?.value).toBeCloseTo(
      truthSum("intelliplan_timmar_MBAB_2026-08.xlsx", "timmar", "2026-08"),
      6,
    );
    const months = truthSum("intelliplan_konsulter_MBAB.xlsx", "anstallningsmanader", "2026-09");
    const people = truthSum("intelliplan_konsulter_MBAB.xlsx", "anstallda_konsulter", "2026-09");
    expect(byKey.anstallningstid?.total.value).toBeCloseTo(months / people, 6);
    for (const key of METRICS) expect(byKey[key]?.status, key).toBe("ok");
  });

  it("serves ledger budgets in SIE sign times the group sign, derived for kostnader and resultat", async () => {
    const { fromSql } = await run({ company: "MBAB" });
    const budget = (key: string) =>
      fromSql.results.find((m) => m.metricKey === key)?.total.compare.budget?.value;
    const truth = readTruth(manifestEntry("budget_2026.xlsx")).filter(
      (f) => f.company === "MBAB" && f.month === "2026-09",
    );
    const of = (...groups: string[]) =>
      truth
        .filter((f) => groups.includes(f.dims.kontogrupp ?? ""))
        .reduce((a, f) => a + f.value, 0);
    const costs = ["varor_ul", "ovriga_externa", "personal", "avskrivningar", "ovriga_rorelse"];
    expect(budget("intakter")).toBeCloseTo(-of("intakter"), 6);
    expect(budget("intakter")).toBeGreaterThan(0);
    expect(budget("kostnader")).toBeCloseTo(of(...costs), 6);
    expect(budget("resultat")).toBeCloseTo(-of("intakter", "finansiella", ...costs), 6);
  });

  const windows = ["month", "quarter", "ytd", "r12"] as const;
  const companies: CompanyFilter[] = ["MBAB", "ALL"];
  const groupBys = [null, "kund", "verksamhet", "bolag", "ort", "kostnadsstalle"] as const;

  describe.each(windows)("window %s", (grain) => {
    it.each(companies.flatMap((c) => groupBys.map((g) => [c, g] as const)))(
      "company %s, group by %s",
      async (company, groupBy) => {
        const { fromSql, fromMemory } = await run({
          period: { grain, anchor: "2026-09" },
          company,
          groupBy,
          topN: groupBy === null ? null : 3,
        });
        expect(statuses(fromSql)).toEqual(statuses(fromMemory));
        expect(differences(fromSql, fromMemory)).toEqual([]);
      },
    );
  });

  it("agrees with filters on verksamhet, ort and kostnadsställe", async () => {
    const filters = [
      [{ dimension: "verksamhet", valueIds: [valueIds.verksamhet!.krom!] }],
      [{ dimension: "verksamhet", valueIds: [valueIds.verksamhet!.bemanning!] }],
      [{ dimension: "ort", valueIds: [valueIds.ort!.stockholm!] }],
      [{ dimension: "kostnadsstalle", valueIds: [valueIds.kostnadsstalle!["MBAB:100"]!] }],
    ];
    for (const f of filters) {
      const { fromSql, fromMemory } = await run({
        period: { grain: "quarter", anchor: "2026-09" },
        filters: f,
      });
      expect(differences(fromSql, fromMemory), JSON.stringify(f)).toEqual([]);
    }
  });

  it("agrees on a budget-scenario query and on the previous year", async () => {
    for (const input of [
      { scenario: "budget" as const, period: { grain: "ytd" as const, anchor: "2026-09" } },
      { period: { grain: "year" as const, anchor: "2025-12" }, groupBy: "bolag" },
    ]) {
      const { fromSql, fromMemory } = await run(input);
      expect(differences(fromSql, fromMemory)).toEqual([]);
    }
  });
});
