import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureValue, rpc, stage, stageAndPublish, valueId } from "./fixtures";
import { asUser, createAppUser, createTestDb, type Db } from "./harness";

interface MonthlyRow {
  metric_key: string;
  month: string;
  grp: Record<string, number | string | null>;
  value: number;
}

describe("query RPCs", () => {
  let db: Db;
  let app: string;
  let krom: number;
  let kvl: number;
  let kundA: number;
  let kundB: number;
  let k1: number;
  let k2: number;
  let k3: number;
  let k4: number;
  let ks100: number;
  let ks200: number;
  let projekt: number;
  const ids: Record<string, string> = {};

  /** Rows of a set-returning RPC with month as YYYY-MM and numbers as numbers. */
  async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await rpc<Record<string, unknown>>(db, app, sql, params);
    return rows.map((row) => {
      const out: Record<string, unknown> = { ...row };
      if (row.month instanceof Date) out.month = row.month.toISOString().slice(0, 7);
      for (const k of ["value", "cnt"]) if (k in row && row[k] !== null) out[k] = Number(row[k]);
      return out as T;
    });
  }

  const monthly = (
    keys: string[],
    opts: {
      companies?: string[] | null;
      scenario?: string;
      from?: string;
      to?: string;
      groupBy?: string[];
      filters?: unknown[];
    } = {},
  ) =>
    query<MonthlyRow>(`select * from public.metric_monthly($1, $2, $3, $4, $5, $6, $7)`, [
      keys,
      opts.companies === undefined ? ["MBAB", "MBR"] : opts.companies,
      opts.scenario ?? "utfall",
      opts.from ?? "2026-07-01",
      opts.to ?? "2026-09-01",
      opts.groupBy ?? [],
      JSON.stringify(opts.filters ?? []),
    ]);

  beforeAll(async () => {
    db = await createTestDb();
    app = await createAppUser(db);
    krom = await valueId(db, "verksamhet", "krom");
    kvl = await valueId(db, "verksamhet", "kvl");
    kundA = await ensureValue(db, "kund", "kund a", "Kund A");
    kundB = await ensureValue(db, "kund", "kund b", "Kund B");
    k1 = await ensureValue(db, "konsult", "1001");
    k2 = await ensureValue(db, "konsult", "1002");
    k3 = await ensureValue(db, "konsult", "1003");
    k4 = await ensureValue(db, "konsult", "1004");
    ks100 = await ensureValue(db, "kostnadsstalle", "MBAB:100", "100 Stockholm");
    ks200 = await ensureValue(db, "kostnadsstalle", "MBAB:200", "200 Göteborg");
    projekt = await ensureValue(db, "uppdrag", "p1", "Projekt 1");

    const fact = (
      month: string,
      company: "MBAB" | "MBR",
      kund: number,
      konsult: number,
      verksamhet: number,
      value: number,
      metric = "timmar",
    ) => ({
      metric,
      company,
      month,
      dims: { kund, konsult, verksamhet },
      value,
    });

    ids.u1 = (
      await stageAndPublish(db, app, {
        dataset: "ip_timmar",
        file: "u1",
        slices: ["2026-07", "2026-08", "2026-09"].map((month) => ({
          company: "MBAB" as const,
          month,
        })),
        facts: [
          fact("2026-07", "MBAB", kundA, k1, krom, 10),
          fact("2026-07", "MBAB", kundB, k2, kvl, 20),
          fact("2026-08", "MBAB", kundA, k1, krom, 5),
          fact("2026-08", "MBAB", kundA, k3, krom, 7),
          fact("2026-09", "MBAB", kundB, k2, kvl, 4),
          fact("2026-09", "MBAB", kundA, k1, krom, 1),
        ],
      })
    ).id;
    ids.u2 = (
      await stageAndPublish(db, app, {
        dataset: "ip_timmar",
        file: "u2",
        slices: [{ company: "MBR", month: "2026-08" }],
        facts: [
          fact("2026-08", "MBR", kundA, k4, krom, 8),
          fact("2026-08", "MBR", kundA, k4, krom, 2, "pass"),
        ],
      })
    ).id;
    // Replaces MBAB September.
    ids.u3 = (
      await stageAndPublish(db, app, {
        dataset: "ip_timmar",
        file: "u3",
        slices: [{ company: "MBAB", month: "2026-09" }],
        facts: [
          fact("2026-09", "MBAB", kundB, k2, kvl, 6),
          fact("2026-09", "MBAB", kundB, k4, kvl, 3),
          fact("2026-09", "MBAB", kundA, k3, krom, 0),
        ],
      })
    ).id;
    ids.budget = (
      await stageAndPublish(db, app, {
        dataset: "ip_timmar",
        file: "budget",
        scenario: "budget",
        slices: [{ company: "MBAB", month: "2026-09" }],
        facts: [fact("2026-09", "MBAB", kundA, k1, krom, 100)],
      })
    ).id;
    // Never current: staged only, and published-then-retracted.
    await stage(db, app, {
      dataset: "ip_timmar",
      file: "staged",
      slices: [{ company: "MBAB", month: "2026-08" }],
      facts: [fact("2026-08", "MBAB", kundA, k1, krom, 999)],
    });
    const retracted = await stageAndPublish(db, app, {
      dataset: "ip_timmar",
      file: "retracted",
      slices: [{ company: "MBAB", month: "2026-06" }],
      facts: [fact("2026-06", "MBAB", kundA, k1, krom, 555)],
    });
    await asUser(db, app, (tx) =>
      tx.query(`select public.retract_upload($1, 'test')`, [retracted.id]),
    );

    // Ledger: MBAB 2026 (Jan, Feb), MBR 2026 (Jan), a 2027 MBAB file with previous-year rows.
    ids.sieMbab = (
      await stageAndPublish(db, app, {
        dataset: "fx_bokforing",
        file: "sie-mbab-2026",
        slices: [
          { company: "MBAB", month: "2026-01" },
          { company: "MBAB", month: "2026-02" },
        ],
        ledger: [
          { company: "MBAB", month: "2026-01", account: 3010, amount: -1000 },
          { company: "MBAB", month: "2026-01", account: 3050, amount: -500 },
          { company: "MBAB", month: "2026-01", account: 4010, amount: 300 },
          { company: "MBAB", month: "2026-01", account: 7010, amount: 600 },
          { company: "MBAB", month: "2026-01", account: 8310, amount: -20 },
          {
            company: "MBAB",
            month: "2026-01",
            account: 3010,
            dimNo: 1,
            objectValueId: ks100,
            amount: -700,
          },
          {
            company: "MBAB",
            month: "2026-01",
            account: 3010,
            dimNo: 1,
            objectValueId: ks200,
            amount: -200,
          },
          {
            company: "MBAB",
            month: "2026-01",
            account: 7010,
            dimNo: 1,
            objectValueId: ks100,
            amount: 600,
          },
          {
            company: "MBAB",
            month: "2026-01",
            account: 3010,
            dimNo: 6,
            objectValueId: projekt,
            amount: -1000,
          },
          { company: "MBAB", month: "2026-02", account: 3010, amount: -2000 },
          {
            company: "MBAB",
            month: "2026-02",
            account: 3010,
            dimNo: 1,
            objectValueId: ks100,
            amount: -2000,
          },
        ],
      })
    ).id;
    ids.sieMbr = (
      await stageAndPublish(db, app, {
        dataset: "fx_bokforing",
        file: "sie-mbr-2026",
        slices: [{ company: "MBR", month: "2026-01" }],
        ledger: [{ company: "MBR", month: "2026-01", account: 3010, amount: -50 }],
      })
    ).id;
    await stageAndPublish(db, app, {
      dataset: "fx_bokforing",
      file: "sie-mbab-2027",
      slices: [
        { company: "MBAB", month: "2026-01", priority: -1 },
        { company: "MBAB", month: "2027-01" },
      ],
      ledger: [
        { company: "MBAB", month: "2026-01", account: 3010, amount: -9999, yearOffset: -1 },
        { company: "MBAB", month: "2027-01", account: 3010, amount: -3000 },
      ],
    });
  });
  afterAll(async () => {
    await db.close();
  });

  describe("metric_monthly", () => {
    it("returns current facts only", async () => {
      expect(await monthly(["timmar"], { from: "2026-06-01", to: "2026-10-01" })).toEqual([
        { metric_key: "timmar", month: "2026-07", grp: {}, value: 30 },
        { metric_key: "timmar", month: "2026-08", grp: {}, value: 20 },
        { metric_key: "timmar", month: "2026-09", grp: {}, value: 9 },
      ]);
    });

    it("groups by company", async () => {
      expect(await monthly(["timmar"], { groupBy: ["bolag"] })).toEqual([
        { metric_key: "timmar", month: "2026-07", grp: { bolag: "MBAB" }, value: 30 },
        { metric_key: "timmar", month: "2026-08", grp: { bolag: "MBAB" }, value: 12 },
        { metric_key: "timmar", month: "2026-08", grp: { bolag: "MBR" }, value: 8 },
        { metric_key: "timmar", month: "2026-09", grp: { bolag: "MBAB" }, value: 9 },
      ]);
    });

    it("groups by any dimensions, combined with bolag", async () => {
      const rows = await monthly(["timmar"], { groupBy: ["kund", "bolag"] });
      const aug = rows.filter((r) => r.month === "2026-08");
      expect(aug).toEqual(
        expect.arrayContaining([
          {
            metric_key: "timmar",
            month: "2026-08",
            grp: { kund: kundA, bolag: "MBAB" },
            value: 12,
          },
          { metric_key: "timmar", month: "2026-08", grp: { kund: kundA, bolag: "MBR" }, value: 8 },
        ]),
      );
      expect(aug).toHaveLength(2);
      const sep = await monthly(["timmar"], { from: "2026-09-01", groupBy: ["konsult"] });
      expect(sep.map((r) => [r.grp.konsult, r.value]).sort()).toEqual(
        [
          [k2, 6],
          [k3, 0],
          [k4, 3],
        ].sort(),
      );
    });

    it("gives null for a grouped dimension the facts lack", async () => {
      expect(await monthly(["pass"], { groupBy: ["ort"] })).toEqual([
        { metric_key: "pass", month: "2026-08", grp: { ort: null }, value: 2 },
      ]);
    });

    it("applies filters (any of the ids, all filters)", async () => {
      expect(
        (
          await monthly(["timmar"], { filters: [{ dimension: "verksamhet", valueIds: [kvl] }] })
        ).map((r) => [r.month, r.value]),
      ).toEqual([
        ["2026-07", 20],
        ["2026-09", 9],
      ]);
      expect(
        (
          await monthly(["timmar"], {
            filters: [
              { dimension: "kund", valueIds: [kundA, kundB] },
              { dimension: "verksamhet", valueIds: [krom] },
            ],
          })
        ).map((r) => [r.month, r.value]),
      ).toEqual([
        ["2026-07", 10],
        ["2026-08", 20],
        ["2026-09", 0],
      ]);
      expect(await monthly(["timmar"], { filters: [{ dimension: "ort", valueIds: [1] }] })).toEqual(
        [],
      );
    });

    it("filters companies and several metrics", async () => {
      expect(await monthly(["timmar", "pass"], { companies: ["MBR"] })).toEqual([
        { metric_key: "pass", month: "2026-08", grp: {}, value: 2 },
        { metric_key: "timmar", month: "2026-08", grp: {}, value: 8 },
      ]);
      expect((await monthly(["timmar"], { companies: null })).map((r) => r.value)).toEqual([
        30, 20, 9,
      ]);
    });

    it("keeps the budget scenario separate", async () => {
      expect(await monthly(["timmar"], { scenario: "budget" })).toEqual([
        { metric_key: "timmar", month: "2026-09", grp: {}, value: 100 },
      ]);
    });

    it("rejects malformed filters", async () => {
      await expect(
        rpc(
          db,
          app,
          `select * from public.metric_monthly(array['timmar'], null, 'utfall', '2026-01-01', '2026-12-01', '{}', '{"dimension": "kund"}')`,
        ),
      ).rejects.toThrow(/lista/);
    });
  });

  describe("metric_distinct", () => {
    const distinct = (
      opts: {
        perMonth?: boolean;
        groupBy?: string[];
        filters?: unknown[];
        companies?: string[];
      } = {},
    ) =>
      query<{ month: string | null; grp: Record<string, unknown>; cnt: number }>(
        `select * from public.metric_distinct('timmar', 'konsult', $1, 'utfall', '2026-07-01', '2026-09-01', $2, $3, $4)`,
        [
          opts.companies ?? ["MBAB", "MBR"],
          opts.groupBy ?? [],
          JSON.stringify(opts.filters ?? []),
          opts.perMonth ?? false,
        ],
      );

    it("counts distinct consultants over a quarter, not the sum of months", async () => {
      expect(await distinct()).toEqual([{ month: null, grp: {}, cnt: 4 }]);
      const perMonth = await distinct({ perMonth: true });
      expect(perMonth).toEqual([
        { month: "2026-07", grp: {}, cnt: 2 },
        { month: "2026-08", grp: {}, cnt: 3 },
        { month: "2026-09", grp: {}, cnt: 2 },
      ]);
      expect(perMonth.reduce((s, r) => s + r.cnt, 0)).toBe(7);
    });

    it("ignores facts with value 0 and non-current facts", async () => {
      // k3 has 0 hours in the current September; k1's September hours were superseded.
      expect(
        await distinct({ perMonth: true, filters: [{ dimension: "kund", valueIds: [kundA] }] }),
      ).toEqual([
        { month: "2026-07", grp: {}, cnt: 1 },
        { month: "2026-08", grp: {}, cnt: 3 },
      ]);
    });

    it("groups and filters", async () => {
      expect(await distinct({ groupBy: ["bolag"] })).toEqual(
        expect.arrayContaining([
          { month: null, grp: { bolag: "MBAB" }, cnt: 4 },
          { month: null, grp: { bolag: "MBR" }, cnt: 1 },
        ]),
      );
      expect(await distinct({ filters: [{ dimension: "verksamhet", valueIds: [krom] }] })).toEqual([
        { month: null, grp: {}, cnt: 3 },
      ]);
      expect(await distinct({ companies: ["MBR"] })).toEqual([{ month: null, grp: {}, cnt: 1 }]);
    });
  });

  describe("ledger_monthly", () => {
    const ledger = (
      groups: string[],
      groupBy: string[] = [],
      companies: string[] = ["MBAB", "MBR"],
      from = "2026-01-01",
      to = "2026-02-01",
    ) =>
      query<{ group_key: string; month: string; grp: Record<string, unknown>; value: number }>(
        `select * from public.ledger_monthly($1, $2, $3, $4, $5)`,
        [groups, companies, from, to, groupBy],
      );

    it("applies account ranges and signs", async () => {
      const rows = await ledger(
        ["intakter", "varor_ul", "personal", "kostnader", "finansiella", "resultat"],
        [],
        ["MBAB"],
        "2026-01-01",
        "2026-01-01",
      );
      expect(Object.fromEntries(rows.map((r) => [r.group_key, r.value]))).toEqual({
        intakter: 1500,
        varor_ul: 300,
        personal: 600,
        kostnader: 900,
        finansiella: 20,
        resultat: 620,
      });
    });

    it("lets a year's own file win over previous-year rows from the next file", async () => {
      const rows = await ledger(["intakter"], ["bolag"]);
      expect(rows).toEqual([
        { group_key: "intakter", month: "2026-01", grp: { bolag: "MBAB" }, value: 1500 },
        { group_key: "intakter", month: "2026-01", grp: { bolag: "MBR" }, value: 50 },
        { group_key: "intakter", month: "2026-02", grp: { bolag: "MBAB" }, value: 2000 },
      ]);
    });

    it("splits by kostnadsställe with an 'ofördelat' remainder that adds up to the total", async () => {
      const rows = await ledger(["intakter", "personal"], ["kostnadsstalle"], ["MBAB"]);
      expect(rows).toEqual(
        expect.arrayContaining([
          { group_key: "intakter", month: "2026-01", grp: { kostnadsstalle: ks100 }, value: 700 },
          { group_key: "intakter", month: "2026-01", grp: { kostnadsstalle: ks200 }, value: 200 },
          { group_key: "intakter", month: "2026-01", grp: { kostnadsstalle: null }, value: 600 },
          { group_key: "intakter", month: "2026-02", grp: { kostnadsstalle: ks100 }, value: 2000 },
          { group_key: "personal", month: "2026-01", grp: { kostnadsstalle: ks100 }, value: 600 },
        ]),
      );
      expect(rows).toHaveLength(5);

      const totals = await ledger(["intakter", "personal"], [], ["MBAB"]);
      for (const total of totals) {
        const parts = rows.filter(
          (r) => r.group_key === total.group_key && r.month === total.month,
        );
        expect(
          parts.reduce((s, r) => s + r.value, 0),
          `${total.group_key} ${total.month}`,
        ).toBe(total.value);
      }
    });

    it("combines kostnadsställe with bolag", async () => {
      const rows = await ledger(
        ["intakter"],
        ["bolag", "kostnadsstalle"],
        ["MBAB", "MBR"],
        "2026-01-01",
        "2026-01-01",
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            group_key: "intakter",
            month: "2026-01",
            grp: { bolag: "MBAB", kostnadsstalle: ks100 },
            value: 700,
          },
          {
            group_key: "intakter",
            month: "2026-01",
            grp: { bolag: "MBAB", kostnadsstalle: ks200 },
            value: 200,
          },
          {
            group_key: "intakter",
            month: "2026-01",
            grp: { bolag: "MBAB", kostnadsstalle: null },
            value: 600,
          },
          {
            group_key: "intakter",
            month: "2026-01",
            grp: { bolag: "MBR", kostnadsstalle: null },
            value: 50,
          },
        ]),
      );
      expect(rows).toHaveLength(4);
    });
  });

  describe("metric_coverage", () => {
    const coverage = (keys: string[], scenario = "utfall", companies = ["MBAB", "MBR"]) =>
      query<{ metric_key: string; month: string }>(
        `select * from public.metric_coverage($1, $2, $3, '2026-01-01', '2026-12-01')`,
        [keys, companies, scenario],
      );

    it("lists months with a current slice of the metric's dataset", async () => {
      const rows = await coverage([
        "timmar",
        "konsulter",
        "intakter",
        "faktor",
        "anstallda_konsulter",
      ]);
      const byKey: Record<string, string[]> = {};
      for (const r of rows) (byKey[r.metric_key] ??= []).push(r.month);
      expect(byKey).toEqual({
        intakter: ["2026-01", "2026-02"],
        konsulter: ["2026-07", "2026-08", "2026-09"],
        timmar: ["2026-07", "2026-08", "2026-09"],
      });
    });

    it("respects scenario and companies", async () => {
      expect(await coverage(["timmar"], "budget")).toEqual([
        { metric_key: "timmar", month: "2026-09" },
      ]);
      expect(await coverage(["timmar"], "utfall", ["MBR"])).toEqual([
        { metric_key: "timmar", month: "2026-08" },
      ]);
    });
  });

  describe("metric_sources", () => {
    it("lists the published uploads behind current data with the months they supply", async () => {
      const rows = await rpc<{
        upload_id: string;
        file_name: string;
        dataset_key: string;
        template_name: string | null;
        months: Date[];
      }>(
        db,
        app,
        `select * from public.metric_sources(array['timmar'], array['MBAB', 'MBR'], '2026-07-01', '2026-09-01')`,
      );
      const simplified = Object.fromEntries(
        rows.map((r) => [
          r.upload_id,
          {
            file: r.file_name,
            dataset: r.dataset_key,
            template: r.template_name,
            months: r.months.map((m) => m.toISOString().slice(0, 7)),
          },
        ]),
      );
      expect(simplified).toEqual({
        [ids.u1!]: {
          file: "u1.xlsx",
          dataset: "ip_timmar",
          template: null,
          months: ["2026-07", "2026-08"],
        },
        [ids.u2!]: { file: "u2.xlsx", dataset: "ip_timmar", template: null, months: ["2026-08"] },
        [ids.u3!]: { file: "u3.xlsx", dataset: "ip_timmar", template: null, months: ["2026-09"] },
        [ids.budget!]: {
          file: "budget.xlsx",
          dataset: "ip_timmar",
          template: null,
          months: ["2026-09"],
        },
      });
    });

    it("covers ledger metrics and company filters", async () => {
      const rows = await rpc<{ upload_id: string }>(
        db,
        app,
        `select * from public.metric_sources(array['resultat'], array['MBR'], '2026-01-01', '2026-12-01')`,
      );
      expect(rows.map((r) => r.upload_id)).toEqual([ids.sieMbr]);
    });
  });
});
