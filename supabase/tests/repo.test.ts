// The repo adapters (src/lib/db/repo) end-to-end against the migrated schema, through
// RLS as an allowlisted user, via a PostgREST-like client.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG_METRICS } from "@/lib/contracts/catalog";
import type { FactRow, UploadCreate } from "@/lib/contracts/import-payload";
import type { SourceScope } from "@/lib/contracts/metric-query";
import type { ResolvedReport, SlideSpec } from "@/lib/contracts/slides";
import {
  addAlias,
  ensureDimensionValues,
  listMetricDefinitions,
  loadDimensionDictionary,
  mergeDimensionValues,
} from "@/lib/db/repo/catalog";
import {
  createDashboard,
  getDefaultDashboard,
  setDefaultDashboard,
} from "@/lib/db/repo/dashboards";
import { SupabaseMetricDataSource } from "@/lib/db/repo/metrics";
import {
  createReportTemplate,
  freezeReport,
  getFrozenReport,
  listFrozenReports,
} from "@/lib/db/repo/reports";
import {
  closePeriod,
  getSettings,
  listClosedPeriods,
  reopenPeriod,
  setDeviationThresholdPct,
} from "@/lib/db/repo/settings";
import { DbError, type DbClient } from "@/lib/db/repo/shared";
import { createTemplate, createTemplateVersion, getTemplate } from "@/lib/db/repo/templates";
import {
  createUpload,
  getUpload,
  listUploads,
  publishUpload,
  retractUpload,
  reviewCompare,
  stageFacts,
  stageUpload,
} from "@/lib/db/repo/uploads";
import { sha256 } from "./fixtures";
import { createAppUser, createTestDb, type Db } from "./harness";
import { pgClient } from "./pg-client";

const upload = (file: string, over: Partial<UploadCreate>): UploadCreate => ({
  datasetKey: "ip_timmar",
  templateId: null,
  templateVersion: null,
  scenario: "utfall",
  fileName: `${file}.xlsx`,
  fileSha256: sha256(file),
  fileSize: 100,
  contentHash: sha256(`c:${file}`),
  engineVersion: 1,
  asOfDate: null,
  slices: [],
  parseReport: { rowsRead: 3 },
  totals: [],
  ...over,
});

const scope = (over: Partial<SourceScope> = {}): SourceScope => ({
  companies: ["MBAB", "MBR"],
  scenario: "utfall",
  from: "2026-07",
  to: "2026-09",
  groupBy: [],
  filters: [],
  ...over,
});

describe("repo adapters against the database", () => {
  let db: Db;
  let client: DbClient;

  beforeAll(async () => {
    db = await createTestDb();
    client = pgClient(db, await createAppUser(db));
  });
  afterAll(async () => {
    await db.close();
  });

  it("reads the catalog as MetricDefinition[]", async () => {
    const defs = await listMetricDefinitions(client);
    expect(defs.map((d) => d.key)).toEqual(CATALOG_METRICS.map((m) => m.key));
    expect(defs.find((d) => d.key === "faktor")?.dimensions).toEqual([
      "kund",
      "uppdrag",
      "konsult",
    ]);
  });

  it("stages, reviews, publishes, queries and retracts an upload", async () => {
    const kund = await ensureDimensionValues(client, "kund", ["Kund A", "Kund B"], { force: true });
    const konsult = await ensureDimensionValues(client, "konsult", ["1001", "1002", "1003"]);
    const dict = await loadDimensionDictionary(client, ["kund", "konsult", "verksamhet"]);
    expect(dict.kund?.byNorm["kund a"]).toBe(kund["Kund A"]);
    expect(dict.konsult?.personal).toBe(true);
    const krom = dict.verksamhet!.byNorm.krom!;

    const fact = (month: string, k: string, c: string, value: number): FactRow => ({
      metricKey: "timmar",
      company: "MBAB",
      month,
      dims: { kund: kund[k]!, konsult: konsult[c]!, verksamhet: krom },
      value,
      sourceRows: [2, 3],
    });
    const id = await createUpload(
      client,
      upload("timmar-q3", {
        slices: ["2026-07", "2026-08", "2026-09"].map((month) => ({
          company: "MBAB" as const,
          month,
          priority: 0,
        })),
      }),
    );
    expect(
      await stageFacts(
        client,
        id,
        [
          fact("2026-07", "Kund A", "1001", 10),
          fact("2026-08", "Kund A", "1002", 20),
          fact("2026-09", "Kund B", "1003", 30),
          fact("2026-09", "Kund A", "1001", 5),
        ],
        { chunkSize: 3 },
      ),
    ).toBe(4);

    const review = await reviewCompare(client, id);
    expect(
      review.rows
        .filter((r) => r.metricKey === "timmar")
        .map((r) => [r.month, r.staged, r.deviationPct]),
    ).toEqual([
      ["2026-07", 10, null],
      ["2026-08", 20, 100],
      ["2026-09", 35, 75],
    ]);

    expect(await publishUpload(client, id)).toMatchObject({ current: 3, facts: 4, superseded: [] });

    const ds = new SupabaseMetricDataSource(client);
    expect(await ds.monthly(["timmar"], scope())).toEqual([
      { metricKey: "timmar", month: "2026-07", group: {}, value: 10 },
      { metricKey: "timmar", month: "2026-08", group: {}, value: 20 },
      { metricKey: "timmar", month: "2026-09", group: {}, value: 35 },
    ]);
    expect(
      await ds.monthly(
        ["timmar"],
        scope({ groupBy: ["kund"], filters: [{ dimension: "kund", valueIds: [kund["Kund B"]!] }] }),
      ),
    ).toEqual([
      { metricKey: "timmar", month: "2026-09", group: { kund: kund["Kund B"] }, value: 30 },
    ]);
    expect(await ds.distinct("timmar", "konsult", scope(), false)).toEqual([
      { month: null, group: {}, count: 3 },
    ]);
    expect(await ds.coverage(["timmar", "konsulter", "timmar_per_konsult"], scope())).toEqual({
      timmar: ["2026-07", "2026-08", "2026-09"],
      konsulter: ["2026-07", "2026-08", "2026-09"],
      timmar_per_konsult: [],
    });
    const updated = await ds.lastUpdated(
      ["timmar", "timmar_per_konsult", "aktiva_deltagare"],
      scope(),
    );
    expect(updated.timmar).toMatch(/^2\d{3}-/);
    expect(updated.timmar_per_konsult).toBe(updated.timmar);
    expect(updated.aktiva_deltagare).toBeNull();
    expect(await ds.labels("kund", [kund["Kund A"]!])).toEqual({ [kund["Kund A"]!]: "Kund A" });
    expect(await ds.fiscalStartMonth()).toBe(1);

    const history = await listUploads(client, { datasetKey: "ip_timmar" });
    expect(history[0]).toMatchObject({
      id,
      status: "published",
      companies: ["MBAB"],
      currentMonths: ["2026-07", "2026-08", "2026-09"],
    });

    expect(await retractUpload(client, id, "fel period")).toMatchObject({
      released: 3,
      restored: 0,
    });
    expect(await getUpload(client, id)).toMatchObject({
      status: "retracted",
      retractReason: "fel period",
      currentMonths: [],
    });
    expect(await ds.monthly(["timmar"], scope())).toEqual([]);
  });

  it("stages SIE ledger rows with kostnadsställen and reads utfall and budget", async () => {
    const id = await stageUpload(client, {
      upload: upload("sie-mbab-2026", {
        datasetKey: "fx_bokforing",
        slices: [{ company: "MBAB", month: "2026-01", priority: 0 }],
      }),
      ledger: {
        rows: [
          {
            company: "MBAB",
            month: "2026-01",
            account: 3010,
            dimNo: null,
            objectCode: null,
            amount: -1000,
            yearOffset: 0,
            source: "psaldo",
          },
          {
            company: "MBAB",
            month: "2026-01",
            account: 3010,
            dimNo: 1,
            objectCode: "100",
            amount: -700,
            yearOffset: 0,
            source: "psaldo",
          },
          {
            company: "MBAB",
            month: "2026-01",
            account: 3010,
            dimNo: 6,
            objectCode: "P1",
            amount: -1000,
            yearOffset: 0,
            source: "psaldo",
          },
          {
            company: "MBAB",
            month: "2026-01",
            account: 7010,
            dimNo: null,
            objectCode: null,
            amount: 400,
            yearOffset: 0,
            source: "psaldo",
          },
        ],
        accounts: [
          { company: "MBAB", account: 3010, name: "Försäljning tjänster" },
          { company: "MBAB", account: 7010, name: "Löner" },
        ],
        objects: [{ company: "MBAB", dimNo: 1, code: "100", name: "Stockholm" }],
      },
    });
    await publishUpload(client, id);
    const ks = await ensureDimensionValues(client, "kostnadsstalle", ["MBAB:100"]);
    const ks100 = ks["MBAB:100"]!;

    const ds = new SupabaseMetricDataSource(client);
    const jan = scope({ from: "2026-01", to: "2026-01" });
    const totals = await ds.ledger(["intakter", "resultat"], jan);
    expect(totals.sort((a, b) => a.accountGroupKey.localeCompare(b.accountGroupKey))).toEqual([
      { accountGroupKey: "intakter", month: "2026-01", group: {}, value: 1000 },
      { accountGroupKey: "resultat", month: "2026-01", group: {}, value: 600 },
    ]);
    const byObject = await ds.ledger(["intakter"], { ...jan, groupBy: ["kostnadsstalle"] });
    expect(byObject.sort((a, b) => b.value - a.value)).toEqual([
      {
        accountGroupKey: "intakter",
        month: "2026-01",
        group: { kostnadsstalle: ks100 },
        value: 700,
      },
      {
        accountGroupKey: "intakter",
        month: "2026-01",
        group: { kostnadsstalle: null },
        value: 300,
      },
    ]);
    expect(
      await ds.ledger(["intakter"], {
        ...jan,
        filters: [{ dimension: "kostnadsstalle", valueIds: [ks100] }],
      }),
    ).toEqual([{ accountGroupKey: "intakter", month: "2026-01", group: {}, value: 700 }]);
    expect(await ds.labels("kostnadsstalle", [ks100])).toEqual({ [ks100]: "100 Stockholm" });

    const dict = await loadDimensionDictionary(client, ["kontogrupp"]);
    const budgetId = await stageUpload(client, {
      upload: upload("budget-2026", {
        datasetKey: "budget",
        scenario: "budget",
        slices: [{ company: "MBAB", month: "2026-01", priority: 0 }],
      }),
      facts: [
        {
          metricKey: "budget_belopp",
          company: "MBAB",
          month: "2026-01",
          dims: { kontogrupp: dict.kontogrupp!.byNorm.intakter!, kostnadsstalle: ks100 },
          value: 1200,
          sourceRows: [],
        },
        {
          metricKey: "budget_belopp",
          company: "MBAB",
          month: "2026-01",
          dims: { kontogrupp: dict.kontogrupp!.byNorm.personal!, kostnadsstalle: ks100 },
          value: 500,
          sourceRows: [],
        },
      ],
    });
    await publishUpload(client, budgetId);
    const budget = { ...jan, scenario: "budget" as const };
    const budgetRows = await ds.ledger(["intakter", "personal", "resultat"], budget);
    expect(budgetRows.sort((a, b) => a.accountGroupKey.localeCompare(b.accountGroupKey))).toEqual([
      { accountGroupKey: "intakter", month: "2026-01", group: {}, value: 1200 },
      { accountGroupKey: "personal", month: "2026-01", group: {}, value: 500 },
    ]);
    expect(await ds.ledger(["intakter"], { ...budget, groupBy: ["kostnadsstalle"] })).toEqual([
      {
        accountGroupKey: "intakter",
        month: "2026-01",
        group: { kostnadsstalle: ks100 },
        value: 1200,
      },
    ]);
    expect(await ds.coverage(["intakter"], budget)).toEqual({ intakter: ["2026-01"] });
  });

  it("names new kostnadsställen whose SIE code has letters or odd spacing", async () => {
    const row = (objectCode: string | null, amount: number) => ({
      company: "MBR" as const,
      month: "2026-02",
      account: 3010,
      dimNo: objectCode === null ? null : 1,
      objectCode,
      amount,
      yearOffset: 0,
      source: "psaldo" as const,
    });
    const id = await stageUpload(client, {
      upload: upload("sie-mbr-letters", {
        datasetKey: "fx_bokforing",
        slices: [{ company: "MBR", month: "2026-02", priority: 0 }],
      }),
      ledger: {
        rows: [row(null, -500), row("A1", -200), row("Syd 2", -100)],
        accounts: [
          { company: "MBR", account: 3010, name: "Försäljning" },
          { company: "MBR", account: 3010, name: "Försäljning tjänster" },
        ],
        objects: [
          { company: "MBR", dimNo: 1, code: "A1", name: "Administration" },
          { company: "MBR", dimNo: 1, code: "Syd 2", name: "Region syd" },
        ],
      },
    });
    await publishUpload(client, id);
    const ids = await ensureDimensionValues(client, "kostnadsstalle", ["MBR:A1", "MBR:Syd 2"]);
    const ds = new SupabaseMetricDataSource(client);
    expect(await ds.labels("kostnadsstalle", [ids["MBR:A1"]!, ids["MBR:Syd 2"]!])).toEqual({
      [ids["MBR:A1"]!]: "A1 Administration",
      [ids["MBR:Syd 2"]!]: "Syd 2 Region syd",
    });
  });

  it("round-trips templates, reports, dashboards and settings", async () => {
    const tpl = await createTemplate(client, {
      datasetKey: "wb_deltagare",
      name: "Workbuster deltagare",
      headerSignature: ["tjänst", "startdatum"],
      version: 1,
      config: {
        kind: "cases",
        steps: [],
        columns: [],
        cases: {
          startColumn: "startdatum",
          resultMap: {},
          groupBy: [],
          metrics: { active: "aktiva_deltagare" },
        },
        company: { kind: "per_upload" },
      },
    });
    const v2 = await createTemplateVersion(client, tpl.id, {
      config: { ...tpl.config, steps: [{ op: "drop", column: "namn" }] } as typeof tpl.config,
    });
    expect(v2).toBe(2);
    expect((await getTemplate(client, tpl.id))?.version).toBe(2);
    const staged = await createUpload(
      client,
      upload("wb", {
        datasetKey: "wb_deltagare",
        templateId: tpl.id,
        templateVersion: 2,
        slices: [{ company: "MBR", month: "2026-09", priority: 0 }],
      }),
    );
    expect(await getUpload(client, staged)).toMatchObject({
      templateId: tpl.id,
      templateVersion: 2,
      status: "staged",
    });

    const spec: SlideSpec = {
      id: "s1",
      viz: "bar",
      metricKey: "aktiva_deltagare",
      grain: "month",
      company: "ALL",
      groupBy: "verksamhet",
      filters: [],
      compare: "prev_period",
      topN: null,
      headline: null,
      notes: "",
    };
    const template = await createReportTemplate(client, { name: "Styrelsen", slides: [spec] });
    const report: ResolvedReport = {
      schemaVersion: 1,
      title: "Styrelsen oktober",
      anchorMonth: "2026-09",
      periodLabel: "september 2026",
      generatedAt: "2026-10-12T08:00:00Z",
      slides: [],
    };
    const frozenId = await freezeReport(client, {
      title: "Styrelsen oktober",
      templateId: template.id,
      report,
      specs: [spec],
    });
    expect(await getFrozenReport(client, frozenId)).toMatchObject({
      anchorMonth: "2026-09",
      templateId: template.id,
      report,
      specs: [spec],
    });
    expect((await listFrozenReports(client)).map((r) => r.id)).toEqual([frozenId]);
    const personal = await freezeReport(client, {
      title: "X",
      templateId: null,
      report,
      specs: [{ ...spec, groupBy: "konsult" }],
    }).catch((e: unknown) => e);
    expect(personal).toBeInstanceOf(DbError);
    expect((personal as DbError).message).toMatch(/Personliga dimensioner/);

    const widget = {
      id: "w",
      title: null,
      viz: "kpi" as const,
      metricKey: "timmar",
      company: null,
      groupBy: null,
      filters: [],
      topN: null,
      layout: { x: 0, y: 0, w: 3, h: 2 },
    };
    const a = await createDashboard(client, { name: "A", widgets: [widget] }, { isDefault: true });
    const b = await createDashboard(client, { name: "B", widgets: [widget] });
    await setDefaultDashboard(client, b.id);
    expect((await getDefaultDashboard(client))?.id).toBe(b.id);
    expect(a.id).not.toBe(b.id);

    await setDeviationThresholdPct(client, 30);
    expect((await getSettings(client)).deviationThresholdPct).toBe(30);
    await closePeriod(client, "MBAB", "2026-09");
    expect((await listClosedPeriods(client)).map((p) => [p.company, p.month])).toEqual([
      ["MBAB", "2026-09"],
    ]);
    await reopenPeriod(client, "MBAB", "2026-09");
    expect(await listClosedPeriods(client)).toEqual([]);
  });

  it("adds aliases and merges values", async () => {
    const ort = await ensureDimensionValues(client, "ort", ["Gbg", "Göteborg"]);
    await addAlias(client, "ort", " GÖTEBORGS stad ", ort["Göteborg"]!);
    let dict = await loadDimensionDictionary(client, ["ort"]);
    expect(dict.ort?.byNorm["göteborgs stad"]).toBe(ort["Göteborg"]);
    expect(await mergeDimensionValues(client, ort.Gbg!, ort["Göteborg"]!)).toMatchObject({
      facts: 0,
      ledgerRows: 0,
    });
    dict = await loadDimensionDictionary(client, ["ort"]);
    expect(dict.ort?.byNorm.gbg).toBe(ort["Göteborg"]);
  });
});
