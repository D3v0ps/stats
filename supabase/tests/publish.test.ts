import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  currentSlices,
  ensureValue,
  publish,
  rpc,
  stage,
  stageAndPublish,
  valueId,
  type StageInput,
} from "./fixtures";
import { asUser, createAppUser, createTestDb, type Db } from "./harness";

interface ReviewRow {
  metric_key: string;
  company: string;
  month: string;
  staged: number;
  current: number | null;
  previous: number | null;
  change_pct: number | null;
  deviation_pct: number | null;
  flagged: boolean;
  replaces_current: boolean;
}

describe("upload lifecycle", () => {
  let db: Db;
  let app: string;
  let krom: number;

  const timmar = (months: string[], value = 1, company: "MBAB" | "MBR" = "MBAB"): StageInput => ({
    dataset: "ip_timmar",
    slices: months.map((month) => ({ company, month })),
    facts: months.map((month) => ({
      metric: "timmar",
      company,
      month,
      dims: { verksamhet: krom },
      value,
    })),
  });

  const status = async (id: string) =>
    (await db.query<{ status: string }>(`select status from public.uploads where id = $1`, [id]))
      .rows[0]?.status;

  const retract = (id: string, reason = "fel fil") =>
    rpc<{ r: { released: number; restored: number; restored_from: string[] } }>(
      db,
      app,
      "select public.retract_upload($1, $2) r",
      [id, reason],
    ).then((rows) => rows[0]!.r);

  beforeAll(async () => {
    db = await createTestDb();
    app = await createAppUser(db);
    krom = await valueId(db, "verksamhet", "krom");
  });
  afterAll(async () => {
    await db.close();
  });

  describe("publish", () => {
    it("marks the upload's slices current and returns a summary", async () => {
      const id = await stage(db, app, timmar(["2025-01", "2025-02"]));
      expect(await status(id)).toBe("staged");
      const summary = await publish(db, app, id);
      expect(summary).toMatchObject({
        upload_id: id,
        dataset: "ip_timmar",
        slices: 2,
        current: 2,
        kept: 0,
        superseded: [],
        facts: 2,
        ledger_rows: 0,
      });
      expect(await status(id)).toBe("published");
      const current = await currentSlices(db, "ip_timmar");
      expect(current["MBAB:utfall:2025-01"]).toBe(id);
      expect(current["MBAB:utfall:2025-02"]).toBe(id);
    });

    it("supersedes the previous upload only for the months it covers", async () => {
      const a = await stageAndPublish(db, app, timmar(["2025-04", "2025-05", "2025-06"]));
      const b = await stageAndPublish(db, app, timmar(["2025-05"], 2));
      expect(b.summary.superseded).toEqual([a.id]);
      const current = await currentSlices(db, "ip_timmar");
      expect(current["MBAB:utfall:2025-04"]).toBe(a.id);
      expect(current["MBAB:utfall:2025-05"]).toBe(b.id);
      expect(current["MBAB:utfall:2025-06"]).toBe(a.id);
      expect(await status(a.id)).toBe("published");
    });

    it("keeps companies and scenarios apart", async () => {
      const mbab = await stageAndPublish(db, app, timmar(["2025-08"], 1, "MBAB"));
      const mbr = await stageAndPublish(db, app, timmar(["2025-08"], 1, "MBR"));
      const budget = await stageAndPublish(db, app, { ...timmar(["2025-08"]), scenario: "budget" });
      expect(mbr.summary.superseded).toEqual([]);
      expect(budget.summary.superseded).toEqual([]);
      const current = await currentSlices(db, "ip_timmar");
      expect(current["MBAB:utfall:2025-08"]).toBe(mbab.id);
      expect(current["MBR:utfall:2025-08"]).toBe(mbr.id);
      expect(current["MBAB:budget:2025-08"]).toBe(budget.id);
    });

    it("writes an audit entry with the caller as actor", async () => {
      const { id } = await stageAndPublish(db, app, timmar(["2025-10"]));
      const res = await db.query<{ action: string; actor: string; detail: { dataset: string } }>(
        `select action, actor, detail from public.audit_log where entity_id = $1`,
        [id],
      );
      expect(res.rows).toEqual([
        expect.objectContaining({
          action: "publish",
          actor: app,
          detail: expect.objectContaining({ dataset: "ip_timmar" }),
        }),
      ]);
    });

    it("rejects publishing twice or publishing a non-staged upload", async () => {
      const { id } = await stageAndPublish(db, app, timmar(["2025-11"]));
      await expect(publish(db, app, id)).rejects.toThrow(/Bara förberedda/);
      await expect(publish(db, app, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        /finns inte/,
      );
    });
  });

  describe("validation", () => {
    it("rejects the same file through the same template version, allows a new version", async () => {
      const tpl = await asUser(db, app, async (tx) => {
        const t = await tx.query<{ id: string }>(
          `insert into public.import_templates (dataset_id, name, kind)
           values ((select id from public.datasets where key = 'ip_timmar'), 'Timmar', 'table') returning id`,
        );
        const id = t.rows[0]!.id;
        await tx.query(
          `insert into public.import_template_versions (template_id, version, config)
           values ($1, 1, '{"kind": "table"}'), ($1, 2, '{"kind": "table"}')`,
          [id],
        );
        return id;
      });
      const base = { ...timmar(["2024-01"]), file: "timmar-jan.xlsx", templateId: tpl };
      const first = await stageAndPublish(db, app, { ...base, templateVersion: 1 });
      const again = await stage(db, app, { ...base, templateVersion: 1 });
      await expect(publish(db, app, again)).rejects.toThrow(/redan publicerad/);

      const v2 = await stageAndPublish(db, app, { ...base, templateVersion: 2 });
      expect(v2.summary.superseded).toEqual([first.id]);

      // Without a template the same file can also be published once.
      await stageAndPublish(db, app, { ...timmar(["2024-02"]), file: "no-template.xlsx" });
      const dup = await stage(db, app, { ...timmar(["2024-02"]), file: "no-template.xlsx" });
      await expect(publish(db, app, dup)).rejects.toThrow(/redan publicerad/);

      // After a retract the file may be published again.
      await asUser(db, app, (tx) =>
        tx.query(`select public.retract_upload($1, 'ny version')`, [v2.id]),
      );
      const redo = await stage(db, app, { ...base, templateVersion: 2 });
      await expect(publish(db, app, redo)).resolves.toMatchObject({ current: 1 });

      // A template of another dataset cannot be used.
      const wrong = await stage(db, app, {
        dataset: "ip_franvaro",
        slices: [{ company: "MBAB", month: "2024-01" }],
        templateId: tpl,
        templateVersion: 1,
      });
      await expect(publish(db, app, wrong)).rejects.toThrow(/annan datakälla/);
    });

    it("rejects facts whose metric is not in the upload's dataset", async () => {
      for (const metric of ["sjuktimmar", "konsulter", "faktor", "intakter"]) {
        const id = await stage(db, app, {
          dataset: "ip_timmar",
          slices: [{ company: "MBAB", month: "2024-03" }],
          facts: [{ metric, company: "MBAB", month: "2024-03", value: 1 }],
        });
        await expect(publish(db, app, id), metric).rejects.toThrow(/hör till datakällan/);
      }
    });

    it("rejects facts outside the upload's companies and months", async () => {
      const id = await stage(db, app, {
        dataset: "ip_timmar",
        slices: [{ company: "MBAB", month: "2024-03" }],
        facts: [{ metric: "timmar", company: "MBR", month: "2024-03", value: 1 }],
      });
      await expect(publish(db, app, id)).rejects.toThrow(/utanför sina bolag och månader/);
    });

    it("rejects dims that are not dimension values of the dataset", async () => {
      const malmo = await ensureValue(db, "ort", "malmö", "Malmö");
      const bad: Record<string, number>[] = [
        { ort: malmo },
        { verksamhet: malmo },
        { kund: 999999 },
      ];
      for (const dims of bad) {
        const id = await stage(db, app, {
          dataset: "ip_timmar",
          slices: [{ company: "MBAB", month: "2024-03" }],
          facts: [{ metric: "timmar", company: "MBAB", month: "2024-03", dims, value: 1 }],
        });
        await expect(publish(db, app, id), JSON.stringify(dims)).rejects.toThrow(
          /dimensionsvärden/,
        );
      }
    });

    it("rejects an engine version below settings.min_engine_version", async () => {
      await db.query(`update public.settings set value = '2' where key = 'min_engine_version'`);
      try {
        const old = await stage(db, app, { ...timmar(["2024-04"]), engineVersion: 1 });
        await expect(publish(db, app, old)).rejects.toThrow(/för gammal version/);
        const fresh = await stage(db, app, { ...timmar(["2024-04"]), engineVersion: 2 });
        await expect(publish(db, app, fresh)).resolves.toMatchObject({ current: 1 });
      } finally {
        await db.query(`update public.settings set value = '1' where key = 'min_engine_version'`);
      }
    });

    it("rejects SIE ledger rows whose company does not match the upload", async () => {
      const id = await stage(db, app, {
        dataset: "fx_bokforing",
        slices: [{ company: "MBAB", month: "2024-01" }],
        ledger: [{ company: "MBR", month: "2024-01", account: 3010, amount: -100 }],
      });
      await expect(publish(db, app, id)).rejects.toThrow(/bolag eller månader stämmer inte/);

      const twoCompanies = await stage(db, app, {
        dataset: "fx_bokforing",
        slices: [
          { company: "MBAB", month: "2024-01" },
          { company: "MBR", month: "2024-01" },
        ],
        ledger: [{ company: "MBAB", month: "2024-01", account: 3010, amount: -100 }],
      });
      await expect(publish(db, app, twoCompanies)).rejects.toThrow(/ett bolag/);

      const notLedger = await stage(db, app, {
        dataset: "ip_timmar",
        slices: [{ company: "MBAB", month: "2024-01" }],
        ledger: [{ company: "MBAB", month: "2024-01", account: 3010, amount: -100 }],
      });
      await expect(publish(db, app, notLedger)).rejects.toThrow(/bokföringskälla/);
    });

    it("rejects an upload without slices", async () => {
      const id = await stage(db, app, { dataset: "ip_timmar", slices: [] });
      await expect(publish(db, app, id)).rejects.toThrow(/saknar månader/);
    });

    it("rejects dimension 1 ledger object rows that are not the company's kostnadsställen", async () => {
      const own = await ensureValue(db, "kostnadsstalle", "MBAB:900", "900 Test");
      const otherCompany = await ensureValue(db, "kostnadsstalle", "MBR:900", "900 Test");
      const ledger = (dimNo: number, objectValueId: number) => ({
        dataset: "fx_bokforing",
        slices: [{ company: "MBAB" as const, month: "2024-02" }],
        ledger: [
          { company: "MBAB" as const, month: "2024-02", account: 3010, amount: -100 },
          {
            company: "MBAB" as const,
            month: "2024-02",
            account: 3010,
            dimNo,
            objectValueId,
            amount: -60,
          },
        ],
      });
      for (const [name, input] of [
        ["another company's kostnadsställe", ledger(1, otherCompany)],
        ["a value of another dimension", ledger(1, krom)],
      ] as const) {
        const id = await stage(db, app, input);
        await expect(publish(db, app, id), name).rejects.toThrow(/objektrader/);
      }
      const ok = await stage(db, app, ledger(1, own));
      await expect(publish(db, app, ok)).resolves.toMatchObject({ ledger_rows: 2 });
    });

    it("rejects facts on a kostnadsställe of another company or without company scope", async () => {
      const own = await ensureValue(db, "kostnadsstalle", "MBR:910", "910 Budget");
      const other = await ensureValue(db, "kostnadsstalle", "MBAB:910", "910 Budget");
      const unscoped = await ensureValue(db, "kostnadsstalle", "910", "910");
      const intakter = await valueId(db, "kontogrupp", "intakter");
      const budget = (kostnadsstalle: number): StageInput => ({
        dataset: "budget",
        scenario: "budget",
        slices: [{ company: "MBR", month: "2024-03" }],
        facts: [
          {
            metric: "budget_belopp",
            company: "MBR",
            month: "2024-03",
            dims: { kontogrupp: intakter, kostnadsstalle },
            value: 100,
          },
        ],
      });
      for (const [name, ks] of [
        ["another company's", other],
        ["unscoped", unscoped],
      ] as const) {
        const id = await stage(db, app, budget(ks));
        await expect(publish(db, app, id), name).rejects.toThrow(/kostnadsställe/);
      }
      const ok = await stage(db, app, budget(own));
      await expect(publish(db, app, ok)).resolves.toMatchObject({ facts: 1 });
    });
  });

  describe("publish order", () => {
    it("orders uploads published in one transaction by when they were published", async () => {
      // published_at must follow the order in which publishes take effect, even when
      // they share a transaction start time, so retract restores the latest one.
      const [a, b] = await asUser(db, app, async (tx) => {
        const ids: string[] = [];
        for (const value of [1, 2]) {
          const input = timmar(["2021-06"], value);
          const res = await tx.query<{ id: string }>(
            `insert into public.uploads (dataset_id, scenario, file_name, file_sha256, file_size,
               content_hash, engine_version)
             select d.id, 'utfall', 'tx.xlsx', md5($1) || md5($1), 1, md5($2) || md5($2), 1
             from public.datasets d where d.key = $3 returning id`,
            [`tx-${value}`, `c-${value}`, input.dataset],
          );
          const id = res.rows[0]!.id;
          await tx.query(
            `insert into public.upload_slices (upload_id, dataset_id, company_id, scenario, month)
             select u.id, u.dataset_id, 1, 'utfall', '2021-06-01' from public.uploads u where u.id = $1`,
            [id],
          );
          await tx.query(`select public.publish_upload($1)`, [id]);
          ids.push(id);
        }
        return ids as [string, string];
      });
      const times = await db.query<{ id: string; published_at: Date }>(
        `select id, published_at from public.uploads where id = any($1) order by published_at`,
        [[a, b]],
      );
      expect(times.rows.map((r) => r.id)).toEqual([a, b]);
      expect(times.rows[0]!.published_at.getTime()).toBeLessThan(
        times.rows[1]!.published_at.getTime(),
      );
      const c = await stageAndPublish(db, app, timmar(["2021-06"], 3));
      await retract(c.id);
      expect((await currentSlices(db, "ip_timmar"))["MBAB:utfall:2021-06"]).toBe(b);
    });
  });

  describe("retract", () => {
    it("restores the previous upload for each month", async () => {
      const a = await stageAndPublish(db, app, timmar(["2023-01", "2023-02", "2023-03"]));
      const b = await stageAndPublish(db, app, timmar(["2023-02"], 2));
      const c = await stageAndPublish(db, app, timmar(["2023-02", "2023-03"], 3));

      const r1 = await retract(c.id);
      expect(r1).toMatchObject({ released: 2, restored: 2 });
      expect(new Set(r1.restored_from)).toEqual(new Set([a.id, b.id]));
      let current = await currentSlices(db, "ip_timmar");
      expect(current["MBAB:utfall:2023-01"]).toBe(a.id);
      expect(current["MBAB:utfall:2023-02"]).toBe(b.id);
      expect(current["MBAB:utfall:2023-03"]).toBe(a.id);
      expect(await status(c.id)).toBe("retracted");

      await retract(b.id);
      current = await currentSlices(db, "ip_timmar");
      expect(current["MBAB:utfall:2023-02"]).toBe(a.id);

      const r3 = await retract(a.id);
      expect(r3).toMatchObject({ released: 3, restored: 0 });
      current = await currentSlices(db, "ip_timmar");
      expect(current["MBAB:utfall:2023-01"]).toBeUndefined();

      const reason = await db.query<{ retract_reason: string; retracted_at: Date | null }>(
        `select retract_reason, retracted_at from public.uploads where id = $1`,
        [a.id],
      );
      expect(reason.rows[0]).toMatchObject({ retract_reason: "fel fil" });
      expect(reason.rows[0]?.retracted_at).not.toBeNull();
    });

    it("only releases the months where the upload is current", async () => {
      const a = await stageAndPublish(db, app, timmar(["2023-05", "2023-06"]));
      const b = await stageAndPublish(db, app, timmar(["2023-06"], 2));
      const r = await retract(a.id);
      expect(r).toMatchObject({ released: 1, restored: 0 });
      const current = await currentSlices(db, "ip_timmar");
      expect(current["MBAB:utfall:2023-05"]).toBeUndefined();
      expect(current["MBAB:utfall:2023-06"]).toBe(b.id);
    });

    it("rejects retracting staged or already retracted uploads", async () => {
      const staged = await stage(db, app, timmar(["2023-08"]));
      await expect(retract(staged)).rejects.toThrow(/Bara publicerade/);
      const { id } = await stageAndPublish(db, app, timmar(["2023-08"]));
      await retract(id);
      await expect(retract(id)).rejects.toThrow(/Bara publicerade/);
    });
  });

  describe("discard", () => {
    it("deletes the staged rows and marks the upload discarded", async () => {
      const id = await stage(db, app, timmar(["2022-01", "2022-02"]));
      const res = await rpc<{ r: { facts: number } }>(
        db,
        app,
        "select public.discard_upload($1) r",
        [id],
      );
      expect(res[0]?.r.facts).toBe(2);
      expect(await status(id)).toBe("discarded");
      const facts = await db.query<{ n: number }>(
        `select count(*)::int n from public.metric_values where upload_id = $1`,
        [id],
      );
      expect(facts.rows[0]?.n).toBe(0);
      await expect(publish(db, app, id)).rejects.toThrow(/Bara förberedda/);
    });

    it("refuses published uploads", async () => {
      const { id } = await stageAndPublish(db, app, timmar(["2022-03"]));
      await expect(rpc(db, app, "select public.discard_upload($1)", [id])).rejects.toThrow(
        /Bara förberedda/,
      );
    });
  });

  describe("SIE priority", () => {
    const sie = (year: number, file: string, ownMonths: string[], prevMonths: string[]) => ({
      dataset: "fx_bokforing",
      file,
      slices: [
        ...ownMonths.map((month) => ({ company: "MBAB" as const, month })),
        ...prevMonths.map((month) => ({ company: "MBAB" as const, month, priority: -1 })),
      ],
      ledger: [
        ...ownMonths.map((month) => ({
          company: "MBAB" as const,
          month,
          account: 3010,
          amount: -year,
        })),
        ...prevMonths.map((month) => ({
          company: "MBAB" as const,
          month,
          account: 3010,
          amount: -year - 0.5,
          yearOffset: -1,
        })),
      ],
    });

    it("lets a year's own file win over previous-year rows of the next year's file", async () => {
      const y21 = await stageAndPublish(db, app, sie(2021, "sie-2021-a", ["2021-01"], ["2020-01"]));
      expect(y21.summary.current).toBe(2);

      const y20 = await stageAndPublish(db, app, sie(2020, "sie-2020", ["2020-01"], []));
      expect(y20.summary.superseded).toEqual([y21.id]);

      const y21b = await stageAndPublish(
        db,
        app,
        sie(2021, "sie-2021-b", ["2021-01"], ["2020-01"]),
      );
      expect(y21b.summary).toMatchObject({ current: 1, kept: 1, superseded: [y21.id] });
      let current = await currentSlices(db, "fx_bokforing");
      expect(current["MBAB:utfall:2020-01"]).toBe(y20.id);
      expect(current["MBAB:utfall:2021-01"]).toBe(y21b.id);

      // Without the 2020 file, the newest previous-year rows take over.
      await retract(y20.id);
      current = await currentSlices(db, "fx_bokforing");
      expect(current["MBAB:utfall:2020-01"]).toBe(y21b.id);
    });
  });

  describe("review_compare", () => {
    const review = async (id: string) =>
      (
        await rpc<{ r: { dataset: string; threshold_pct: number; rows: ReviewRow[] } }>(
          db,
          app,
          "select public.review_compare($1) r",
          [id],
        )
      )[0]!.r;

    it("compares staged totals with current data and the previous month", async () => {
      const company = "MBR" as const;
      await stageAndPublish(db, app, timmar(["2021-07"], 80, company));
      await stageAndPublish(db, app, timmar(["2021-08"], 100, company));
      const id = await stage(db, app, {
        dataset: "ip_timmar",
        slices: [
          { company, month: "2021-08" },
          { company, month: "2021-09" },
        ],
        facts: [
          { metric: "timmar", company, month: "2021-08", dims: { verksamhet: krom }, value: 60 },
          { metric: "timmar", company, month: "2021-08", dims: { verksamhet: krom }, value: 50 },
          { metric: "timmar", company, month: "2021-09", dims: { verksamhet: krom }, value: 150 },
          { metric: "pass", company, month: "2021-09", value: 12 },
        ],
      });
      const r = await review(id);
      expect(r.dataset).toBe("ip_timmar");
      expect(r.threshold_pct).toBe(25);
      const timmarRows = r.rows.filter((row) => row.metric_key === "timmar");
      expect(timmarRows).toEqual([
        {
          metric_key: "timmar",
          company,
          month: "2021-08",
          staged: 110,
          current: 100,
          previous: 80,
          change_pct: 10,
          deviation_pct: 37.5,
          flagged: true,
          replaces_current: true,
        },
        {
          metric_key: "timmar",
          company,
          month: "2021-09",
          staged: 150,
          current: null,
          previous: 110,
          change_pct: null,
          deviation_pct: 36.4,
          flagged: true,
          replaces_current: true,
        },
      ]);
      // Every metric of the dataset is listed, also those without rows (staged 0).
      const pass = r.rows.filter((row) => row.metric_key === "pass");
      expect(pass.map((row) => [row.month, row.staged, row.current])).toEqual([
        ["2021-08", 0, 0],
        ["2021-09", 12, null],
      ]);
    });

    it("uses the deviation threshold from settings", async () => {
      await db.query(
        `update public.settings set value = '50' where key = 'deviation_threshold_pct'`,
      );
      try {
        await stageAndPublish(db, app, timmar(["2021-10"], 100, "MBR"));
        const id = await stage(db, app, timmar(["2021-11"], 140, "MBR"));
        const row = (await review(id)).rows.find((x) => x.metric_key === "timmar");
        expect(row).toMatchObject({ deviation_pct: 40, flagged: false });
      } finally {
        await db.query(
          `update public.settings set value = '25' where key = 'deviation_threshold_pct'`,
        );
      }
    });

    it("reports ledger metrics for SIE uploads and whether low-priority slices replace current data", async () => {
      await stageAndPublish(db, app, {
        dataset: "fx_bokforing",
        file: "sie-2019",
        slices: [{ company: "MBR", month: "2019-12" }],
        ledger: [
          { company: "MBR", month: "2019-12", account: 3010, amount: -1000 },
          { company: "MBR", month: "2019-12", account: 7010, amount: 400 },
        ],
      });
      const id = await stage(db, app, {
        dataset: "fx_bokforing",
        file: "sie-2020",
        slices: [
          { company: "MBR", month: "2019-12", priority: -1 },
          { company: "MBR", month: "2020-01" },
        ],
        ledger: [
          { company: "MBR", month: "2019-12", account: 3010, amount: -1100, yearOffset: -1 },
          { company: "MBR", month: "2020-01", account: 3010, amount: -2000 },
          { company: "MBR", month: "2020-01", account: 7010, amount: 500 },
        ],
      });
      const rows = (await review(id)).rows;
      const metrics = new Set(rows.map((x) => x.metric_key));
      expect(metrics).toEqual(
        new Set([
          "intakter",
          "varor_ul",
          "ovriga_externa",
          "personal",
          "avskrivningar",
          "ovriga_rorelse",
          "kostnader",
          "finansiella",
          "resultat",
        ]),
      );
      const intakter = rows.filter((x) => x.metric_key === "intakter");
      expect(intakter).toEqual([
        expect.objectContaining({
          month: "2019-12",
          staged: 1100,
          current: 1000,
          replaces_current: false,
        }),
        expect.objectContaining({
          month: "2020-01",
          staged: 2000,
          current: null,
          previous: 1100,
          replaces_current: true,
        }),
      ]);
      const resultat = rows.find((x) => x.metric_key === "resultat" && x.month === "2020-01");
      expect(resultat?.staged).toBe(1500);
    });
  });
});
