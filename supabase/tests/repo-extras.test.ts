// The upload-flow, report-editor and dashboard adapters that live beside the core repo
// (import-extra, present-extra, explore-extra) against the migrated schema: an allowlisted
// user reads and writes through RLS, a signed-in user who is not allowlisted gets nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listMetricDefinitions } from "@/lib/db/repo/catalog";
import { listMetricSources } from "@/lib/db/repo/explore-extra";
import { createMetric, findDuplicate, findPublishedFiles } from "@/lib/db/repo/import-extra";
import { SupabaseMetricDataSource } from "@/lib/db/repo/metrics";
import { listReportFilterValues } from "@/lib/db/repo/present-extra";
import { DbError, type DbClient } from "@/lib/db/repo/shared";
import { createTemplate } from "@/lib/db/repo/templates";
import { retractUpload } from "@/lib/db/repo/uploads";
import { ensureValue, sha256, stage, stageAndPublish, valueId } from "./fixtures";
import { createAppUser, createTestDb, type Db } from "./harness";
import { pgClient } from "./pg-client";

describe("repo extras through RLS", () => {
  let db: Db;
  let app: string;
  let client: DbClient;
  let stranger: DbClient;
  let krom: number;

  beforeAll(async () => {
    db = await createTestDb();
    app = await createAppUser(db);
    client = pgClient(db, app);
    stranger = pgClient(db, await createAppUser(db, { allowlisted: false }));
    krom = await valueId(db, "verksamhet", "krom");
  });
  afterAll(async () => {
    await db.close();
  });

  describe("createMetric (import-extra)", () => {
    it("adds sum and snapshot metrics the catalog and engine see", async () => {
      expect(
        await createMetric(client, {
          key: "overtid",
          name: "  Övertid ",
          unit: "h",
          kind: "sum",
          datasetKey: "ip_timmar",
          higherIsBetter: false,
          headlineSubject: "ÖVERTIDEN",
          description: "Timmar utöver schema.",
        }),
      ).toEqual({
        key: "overtid",
        name: "Övertid",
        unit: "h",
        kind: "sum",
        datasetKey: "ip_timmar",
        higherIsBetter: false,
        decimals: 0,
      });
      expect(
        await createMetric(client, {
          key: "andel_heltid",
          name: "Andel heltid",
          unit: "pct",
          kind: "snapshot",
          datasetKey: "ip_konsulter",
          higherIsBetter: null,
          headlineSubject: "ANDELEN HELTID",
        }),
      ).toMatchObject({ kind: "snapshot", decimals: 1 });

      const defs = await listMetricDefinitions(client);
      expect(defs.find((d) => d.key === "overtid")).toMatchObject({
        kind: "sum",
        datasetKey: "ip_timmar",
        description: "Timmar utöver schema.",
        headlineSubject: "ÖVERTIDEN",
        snapshotRollup: null,
      });
      expect(defs.find((d) => d.key === "overtid")?.dimensions.sort()).toEqual([
        "konsult",
        "kund",
        "uppdrag",
        "verksamhet",
      ]);
      expect(defs.find((d) => d.key === "andel_heltid")).toMatchObject({
        snapshotRollup: "last",
        dimensions: ["ort"],
      });
      const row = await db.query<{ is_system: boolean }>(
        "select is_system from public.metrics where key = 'overtid'",
      );
      expect(row.rows[0]?.is_system).toBe(false);

      // The new metric can be staged and published like a seeded one.
      await stageAndPublish(db, app, {
        dataset: "ip_timmar",
        slices: [{ company: "MBAB", month: "2026-09" }],
        facts: [
          {
            metric: "overtid",
            company: "MBAB",
            month: "2026-09",
            dims: { verksamhet: krom },
            value: 12,
          },
        ],
      });
      const rows = await new SupabaseMetricDataSource(client).monthly(["overtid"], {
        companies: ["MBAB"],
        scenario: "utfall",
        from: "2026-09",
        to: "2026-09",
        groupBy: [],
        filters: [],
      });
      expect(rows.map((r) => r.value)).toEqual([12]);
    });

    it("refuses duplicate keys and unknown datasets", async () => {
      const input = {
        key: "overtid",
        name: "Dubblett",
        unit: "h" as const,
        kind: "sum" as const,
        datasetKey: "ip_timmar",
        higherIsBetter: null,
        headlineSubject: "X",
      };
      await expect(createMetric(client, input)).rejects.toMatchObject({ code: "23505" });
      await expect(
        createMetric(client, { ...input, key: "ny_nyckel", datasetKey: "finns_inte" }),
      ).rejects.toThrow(/Okänd datakälla/);
    });

    it("lets nobody else add metrics", async () => {
      const insert = createMetric(stranger, {
        key: "intrang_sum",
        name: "Intrång",
        unit: "st",
        kind: "sum",
        datasetKey: "ip_timmar",
        higherIsBetter: null,
        headlineSubject: "X",
      });
      // Not allowlisted: the datasets are not even visible.
      await expect(insert).rejects.toThrow(/Okänd datakälla/);
      const raw = await stranger
        .from("metrics")
        .insert({ key: "intrang_raw", name: "x", unit: "st", kind: "sum", dataset_id: 1 });
      expect(raw.error?.code).toBe("42501");
      const n = await db.query<{ n: number }>(
        "select count(*)::int as n from public.metrics where key like 'intrang%'",
      );
      expect(n.rows[0]?.n).toBe(0);
    });
  });

  describe("findPublishedFiles (import-extra)", () => {
    it("lists the published uploads of the given files, newest first", async () => {
      const template = await createTemplate(client, {
        datasetKey: "ip_timmar",
        name: "Timmar",
        headerSignature: ["timmar"],
        version: 1,
        config: {
          kind: "table",
          steps: [],
          columns: [
            {
              column: "timmar",
              type: "hours",
              usage: "measure",
              metricKey: "timmar",
              personal: false,
              keep: true,
            },
          ],
          counters: [],
          period: { kind: "per_upload" },
          company: { kind: "per_upload" },
          scenario: "utfall",
        },
      });
      const slice = (month: string) => ({
        dataset: "ip_timmar",
        slices: [{ company: "MBAB" as const, month }],
      });
      const a1 = await stageAndPublish(db, app, {
        ...slice("2026-01"),
        file: "a",
        templateId: template.id,
        templateVersion: 1,
      });
      const sie = await stageAndPublish(db, app, {
        dataset: "fx_bokforing",
        file: "b",
        slices: [{ company: "MBAB", month: "2026-01" }],
        ledger: [{ company: "MBAB", month: "2026-01", account: 3010, amount: -5 }],
      });
      await stage(db, app, { ...slice("2026-02"), file: "staged-only" });
      const gone = await stageAndPublish(db, app, { ...slice("2026-03"), file: "retracted" });
      await retractUpload(client, gone.id, "fel");

      const found = await findPublishedFiles(client, [
        sha256("a"),
        sha256("b"),
        sha256("a"),
        sha256("staged-only"),
        sha256("retracted"),
      ]);
      expect(found.map((f) => [f.uploadId, f.datasetKey, f.templateId, f.templateVersion])).toEqual(
        [
          [sie.id, "fx_bokforing", null, null],
          [a1.id, "ip_timmar", template.id, 1],
        ],
      );
      expect(found.every((f) => !Number.isNaN(Date.parse(f.publishedAt)))).toBe(true);

      expect(
        findDuplicate(found, {
          datasetKey: "ip_timmar",
          sha256: sha256("a"),
          templateId: template.id,
          templateVersion: 1,
        })?.uploadId,
      ).toBe(a1.id);
      expect(
        findDuplicate(found, {
          datasetKey: "fx_bokforing",
          sha256: sha256("b"),
          templateId: null,
          templateVersion: null,
        })?.uploadId,
      ).toBe(sie.id);
      expect(await findPublishedFiles(client, [])).toEqual([]);
      expect(await findPublishedFiles(stranger, [sha256("a")])).toEqual([]);
    });
  });

  describe("listReportFilterValues (present-extra)", () => {
    it("lists active values of non-personal dimensions only, by sort then label", async () => {
      const zeta = await ensureValue(db, "ort", "zeta", "Zeta");
      const alfa = await ensureValue(db, "ort", "alfa", "Alfa");
      const old = await ensureValue(db, "ort", "gammal", "Gammal");
      await db.query("update public.dimension_values set active = false where id = $1", [old]);
      await ensureValue(db, "konsult", "4711", "Anna Andersson");

      const values = await listReportFilterValues(client);
      expect(values.konsult).toBeUndefined();
      expect(values.ort).toEqual([
        { id: alfa, label: "Alfa" },
        { id: zeta, label: "Zeta" },
      ]);
      expect(values.verksamhet?.map((v) => v.label)).toEqual([
        "ROM2",
        "KROM",
        "KVL",
        "Karriärvägledning",
        "Stöd och matchning",
        "Bemanning",
      ]);
      expect(values.kontogrupp?.map((v) => v.label)).toContain("Övriga rörelsekostnader");
      expect(JSON.stringify(values)).not.toContain("Anna");

      expect(await listReportFilterValues(stranger)).toEqual({});
    });
  });

  describe("listMetricSources (explore-extra)", () => {
    it("lists the current uploads behind metrics with their months, newest first", async () => {
      const first = await stageAndPublish(db, app, {
        dataset: "ip_franvaro",
        file: "franvaro-1",
        slices: [
          { company: "MBR", month: "2026-04" },
          { company: "MBR", month: "2026-05" },
        ],
      });
      const second = await stageAndPublish(db, app, {
        dataset: "ip_franvaro",
        file: "franvaro-2",
        slices: [{ company: "MBR", month: "2026-05" }],
      });
      const sources = await listMetricSources(
        client,
        ["sjuktimmar"],
        ["MBR"],
        "2026-01",
        "2026-12",
      );
      expect(sources.map((s) => [s.uploadId, s.datasetKey, s.months])).toEqual([
        [second.id, "ip_franvaro", ["2026-05"]],
        [first.id, "ip_franvaro", ["2026-04"]],
      ]);
      expect(sources[0]).toMatchObject({
        fileName: "franvaro-2.xlsx",
        templateName: null,
        templateVersion: null,
      });
      expect(await listMetricSources(client, [], ["MBR"], "2026-01", "2026-12")).toEqual([]);
      await expect(
        listMetricSources(stranger, ["sjuktimmar"], ["MBR"], "2026-01", "2026-12"),
      ).rejects.toThrow(/Behörighet saknas/);
    });
  });

  it("surfaces database refusals as DbError", async () => {
    await expect(
      createMetric(client, {
        key: "Ogiltig nyckel",
        name: "Fel",
        unit: "st",
        kind: "sum",
        datasetKey: "ip_timmar",
        higherIsBetter: null,
        headlineSubject: "X",
      }),
    ).rejects.toBeInstanceOf(DbError);
  });
});
