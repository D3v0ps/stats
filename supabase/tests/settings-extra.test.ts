// The settings write adapters (src/lib/db/repo/settings-extra.ts) against the migrated schema:
// an allowlisted user may make every settings change through RLS; a signed-in user who is not
// allowlisted changes nothing; anon has no access at all.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAccountGroups, listMetricDefinitions } from "@/lib/db/repo/catalog";
import { SupabaseMetricDataSource } from "@/lib/db/repo/metrics";
import {
  addAliases,
  createDimensionValues,
  createFormulaMetric,
  listMonthsWithData,
  relabelDimensionValues,
  replaceAccountGroupRanges,
  setCompanyFiscalStart,
  templateUploadCounts,
  updateAccountGroup,
  updateMetric,
} from "@/lib/db/repo/settings-extra";
import { DbError, type DbClient } from "@/lib/db/repo/shared";
import { createTemplate } from "@/lib/db/repo/templates";
import { ensureValue, stageAndPublish, valueId } from "./fixtures";
import { asAnon, createAppUser, createTestDb, type Db } from "./harness";
import { pgClient } from "./pg-client";

async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params);
  return res.rows[0] as T;
}

describe("settings writes through RLS", () => {
  let db: Db;
  let app: string;
  let client: DbClient;
  let stranger: DbClient;

  beforeAll(async () => {
    db = await createTestDb();
    app = await createAppUser(db);
    client = pgClient(db, app);
    stranger = pgClient(db, await createAppUser(db, { allowlisted: false }));
  });
  afterAll(async () => {
    await db.close();
  });

  describe("an allowlisted user", () => {
    it("edits a metric and its formula (the wage uplift)", async () => {
      await updateMetric(client, "faktor", {
        name: "Faktor med påslag",
        description: "Fakturerat ÷ lönekostnad inkl. 31 % påslag.",
        higherIsBetter: true,
        decimals: 3,
        headlineSubject: "faktorn",
        formula: "fakturerat_ip / (lonekostnad * 1.31)",
      });
      expect(
        await one(
          db,
          "select name, decimals, headline_subject, formula from public.metrics where key = 'faktor'",
        ),
      ).toEqual({
        name: "Faktor med påslag",
        decimals: 3,
        headline_subject: "FAKTORN",
        formula: "fakturerat_ip / (lonekostnad * 1.31)",
      });
      await expect(updateMetric(client, "timmar", { formula: "pass * 2" })).rejects.toThrow(
        /Bara formelmått/,
      );
    });

    it("creates a formula metric the catalog and engine see", async () => {
      await createFormulaMetric(client, {
        key: "fakturerat_per_timme",
        name: "Fakturerat per timme",
        unit: "kr",
        formula: "fakturerat_ip / timmar",
        higherIsBetter: true,
        decimals: 0,
        headlineSubject: "timpriset",
      });
      const defs = await listMetricDefinitions(client);
      const created = defs.find((d) => d.key === "fakturerat_per_timme");
      expect(created).toMatchObject({
        kind: "formula",
        datasetKey: null,
        headlineSubject: "TIMPRISET",
      });
      expect(created?.dimensions).toEqual(["kund", "uppdrag", "konsult"]);
      const source = new SupabaseMetricDataSource(client);
      expect((await source.definitions()).some((d) => d.key === "fakturerat_per_timme")).toBe(true);
      // Keys are unique.
      await expect(
        createFormulaMetric(client, {
          key: "fakturerat_per_timme",
          name: "Dubblett",
          unit: "kr",
          formula: "timmar",
          higherIsBetter: null,
          decimals: null,
        }),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("edits account groups and replaces their ranges", async () => {
      await updateAccountGroup(client, "personal", { name: "Personal", sign: 1 });
      await replaceAccountGroupRanges(client, "personal", [
        { from: 7000, to: 7399 },
        { from: 7500, to: 7699 },
      ]);
      const group = (await listAccountGroups(client)).find((g) => g.key === "personal");
      expect(group).toEqual({
        key: "personal",
        name: "Personal",
        sign: 1,
        ranges: [
          { from: 7000, to: 7399 },
          { from: 7500, to: 7699 },
        ],
      });
      // The database rejects an inverted range even past the adapter's own check.
      await expect(
        db.query(
          "insert into public.account_group_ranges (group_key, from_account, to_account) values ('personal', 7600, 7500)",
        ),
      ).rejects.toThrow(/check/);
    });

    it("sets a company's fiscal start month", async () => {
      await setCompanyFiscalStart(client, "MBR", 7);
      expect(
        await one(db, "select fiscal_start_month from public.companies where code = 'MBR'"),
      ).toEqual({ fiscal_start_month: 7 });
      await setCompanyFiscalStart(client, "MBR", 1);
    });

    it("bulk-edits the dictionary: aliases, new values with codes, new labels", async () => {
      const ikea = await ensureValue(db, "kund", "ikea", "IKEA");
      expect(await addAliases(client, "kund", [{ alias: "K-100 ", valueId: ikea }])).toBe(1);
      expect(
        await one(
          db,
          `select a.value_id::int as id from public.dimension_aliases a
           join public.dimensions d on d.id = a.dimension_id
           where d.key = 'kund' and a.alias_norm = 'k-100'`,
        ),
      ).toEqual({ id: ikea });

      const ids = await createDimensionValues(client, "konsult", [
        { code: "9001", label: "Anna Andersson" },
      ]);
      expect(await valueId(db, "konsult", "9001")).toBe(ids["9001"]);
      await relabelDimensionValues(client, [{ id: ids["9001"]!, label: "Anna A." }]);
      expect(
        await one(db, "select label from public.dimension_values where id = $1", [ids["9001"]]),
      ).toEqual({ label: "Anna A." });

      // The personnummer trigger still guards labels set in bulk.
      await expect(
        relabelDimensionValues(client, [{ id: ids["9001"]!, label: "Anna 640823-3234" }]),
      ).rejects.toThrow(/Personnummer/);
    });

    it("lists months with current data and template usage", async () => {
      const verksamhet = await valueId(db, "verksamhet", "krom");
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
      await stageAndPublish(db, app, {
        dataset: "ip_timmar",
        templateId: template.id,
        templateVersion: 1,
        slices: [
          { company: "MBAB", month: "2026-08" },
          { company: "MBAB", month: "2026-09" },
        ],
        facts: [
          { metric: "timmar", company: "MBAB", month: "2026-08", dims: { verksamhet }, value: 5 },
          { metric: "timmar", company: "MBAB", month: "2026-09", dims: { verksamhet }, value: 7 },
        ],
      });
      expect(await listMonthsWithData(client)).toEqual([
        { company: "MBAB", month: "2026-09", datasets: ["ip_timmar"] },
        { company: "MBAB", month: "2026-08", datasets: ["ip_timmar"] },
      ]);
      expect(await templateUploadCounts(client)).toEqual({ [template.id]: 1 });
    });
  });

  describe("a signed-in user who is not allowlisted", () => {
    it("cannot change anything", async () => {
      await expect(updateMetric(stranger, "timmar", { name: "Hackad" })).rejects.toThrow(
        /finns inte/,
      );
      await expect(setCompanyFiscalStart(stranger, "MBAB", 4)).rejects.toThrow(/Okänt bolag/);
      await expect(updateAccountGroup(stranger, "intakter", { name: "X" })).rejects.toThrow(
        /finns inte/,
      );
      await expect(
        replaceAccountGroupRanges(stranger, "intakter", [{ from: 3000, to: 3001 }]),
      ).rejects.toThrow(/finns inte/);
      const insert = createFormulaMetric(stranger, {
        key: "intrang",
        name: "Intrång",
        unit: "st",
        formula: "timmar",
        higherIsBetter: null,
        decimals: null,
      });
      await expect(insert).rejects.toBeInstanceOf(DbError);
      await expect(insert).rejects.toMatchObject({ code: "42501" });
      expect(await listMonthsWithData(stranger)).toEqual([]);

      expect(await one(db, "select name from public.metrics where key = 'timmar'")).toEqual({
        name: "Fakturerade timmar",
      });
      expect(
        await one(db, "select fiscal_start_month from public.companies where code = 'MBAB'"),
      ).toEqual({ fiscal_start_month: 1 });
      expect(
        await one(db, "select count(*)::int as n from public.metrics where key = 'intrang'"),
      ).toEqual({ n: 0 });
    });
  });

  describe("anon", () => {
    const writes: Record<string, string> = {
      "metrics update": "update public.metrics set name = 'x' where key = 'timmar'",
      "metrics insert":
        "insert into public.metrics (key, name, unit, kind, formula) values ('anon_x', 'x', 'st', 'formula', 'timmar')",
      "account_groups update": "update public.account_groups set sign = 1 where key = 'intakter'",
      "account_group_ranges insert":
        "insert into public.account_group_ranges (group_key, from_account, to_account) values ('intakter', 3000, 3001)",
      "account_group_ranges delete": "delete from public.account_group_ranges",
      "companies update": "update public.companies set fiscal_start_month = 4",
      "dimension_aliases insert":
        "insert into public.dimension_aliases (dimension_id, alias_norm, value_id) values (1, 'x', 1)",
      "dimension_values update": "update public.dimension_values set label = 'x'",
      "upload_slices select": "select * from public.upload_slices",
    };

    it.each(Object.entries(writes))("is denied: %s", async (_name, sql) => {
      await expect(asAnon(db, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    });
  });
});
