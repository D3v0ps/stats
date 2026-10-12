import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureValue, rpc, stageAndPublish, valueId } from "./fixtures";
import { asUser, createAppUser, createTestDb, type Db } from "./harness";

describe("dimension values", () => {
  let db: Db;
  let app: string;

  const ensure = async (dimension: string, labels: (string | null)[], force?: boolean) => {
    const rows = await rpc<{ label: string; id: number | null }>(
      db,
      app,
      force === undefined
        ? `select label, id::int as id from public.ensure_dimension_values($1, $2)`
        : `select label, id::int as id from public.ensure_dimension_values($1, $2, $3)`,
      force === undefined ? [dimension, labels] : [dimension, labels, force],
    );
    return Object.fromEntries(rows.map((r) => [r.label, r.id]));
  };

  const valueRow = async (id: number) =>
    (
      await db.query<{ code: string; label: string; active: boolean }>(
        `select code, label, active from public.dimension_values where id = $1`,
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    db = await createTestDb();
    app = await createAppUser(db);
  });
  afterAll(async () => {
    await db.close();
  });

  describe("ensure_dimension_values", () => {
    it("resolves known values of an 'ask' dimension by code or label and leaves unknowns null", async () => {
      const krom = await valueId(db, "verksamhet", "krom");
      const som = await valueId(db, "verksamhet", "stöd och matchning");
      const res = await ensure("verksamhet", [
        "KROM",
        "  Stöd  och   MATCHNING ",
        "Ny tjänst",
        "",
        null,
      ]);
      expect(res).toEqual({
        KROM: krom,
        "  Stöd  och   MATCHNING ": som,
        "Ny tjänst": null,
        "": null,
      });
      const created = await db.query(
        `select 1 from public.dimension_values where code = 'ny tjänst'`,
      );
      expect(created.rows).toEqual([]);
    });

    it("creates unknown values when forced", async () => {
      const res = await ensure("verksamhet", ["Ny tjänst"], true);
      const id = res["Ny tjänst"]!;
      expect(id).toBeGreaterThan(0);
      expect(await valueRow(id)).toEqual({ code: "ny tjänst", label: "Ny tjänst", active: true });
    });

    it("creates values of 'auto_create' dimensions once, normalized", async () => {
      const first = await ensure("ort", ["Malmö", " MALMÖ ", "Lund"]);
      expect(first["Malmö"]).toBe(first[" MALMÖ "]);
      const again = await ensure("ort", ["malmö"]);
      expect(again["malmö"]).toBe(first["Malmö"]);
      expect(await valueRow(first["Malmö"]!)).toEqual({
        code: "malmö",
        label: "Malmö",
        active: true,
      });
      expect(await valueRow(first[" MALMÖ "]!)).toMatchObject({ label: "Malmö" });
    });

    it("resolves aliases before codes", async () => {
      const krom = await valueId(db, "verksamhet", "krom");
      await asUser(db, app, (tx) =>
        tx.query(
          `insert into public.dimension_aliases (dimension_id, alias_norm, value_id)
           select dimension_id, '  Kundval   Rusta och MATCHA ', id from public.dimension_values where id = $1`,
          [krom],
        ),
      );
      const stored = await db.query<{ alias_norm: string }>(
        `select alias_norm from public.dimension_aliases where value_id = $1`,
        [krom],
      );
      expect(stored.rows).toEqual([{ alias_norm: "kundval rusta och matcha" }]);
      expect(await ensure("verksamhet", ["KUNDVAL rusta och matcha"])).toEqual({
        "KUNDVAL rusta och matcha": krom,
      });
    });

    it("matches an active value by normalized label when the code differs", async () => {
      const id = await ensureValue(db, "kund", "k-1001", "Göteborgs Stad");
      expect(await ensure("kund", ["göteborgs  stad"])).toEqual({ "göteborgs  stad": id });
      const intakter = await valueId(db, "kontogrupp", "intakter");
      expect(await ensure("kontogrupp", ["Intäkter", "intakter"])).toEqual({
        Intäkter: intakter,
        intakter,
      });
    });

    it("scopes kostnadsställe codes per company with an uppercase prefix", async () => {
      const res = await ensure("kostnadsstalle", ["MBAB:100", "mbr:100", "MBAB:100 "]);
      expect(res["MBAB:100"]).toBe(res["MBAB:100 "]);
      expect(res["MBAB:100"]).not.toBe(res["mbr:100"]);
      expect((await valueRow(res["MBAB:100"]!))?.code).toBe("MBAB:100");
      expect((await valueRow(res["mbr:100"]!))?.code).toBe("MBR:100");
    });

    it("never creates a kostnadsställe without a company prefix, even when forced", async () => {
      // "100" would be a value no SIE object row ever points at, so budget and utfall per
      // kostnadsställe would silently not line up.
      expect(await ensure("kostnadsstalle", ["100", "Okänd:100", "MBAB:"], true)).toEqual({
        "100": null,
        "Okänd:100": null,
        "MBAB:": null,
      });
      const created = await db.query<{ n: number }>(
        `select count(*)::int n from public.dimension_values dv
         join public.dimensions d on d.id = dv.dimension_id
         where d.key = 'kostnadsstalle' and dv.code in ('100', 'OKÄND:100', 'MBAB:')`,
      );
      expect(created.rows[0]?.n).toBe(0);
      // Existing values still resolve by label or alias.
      const id = (await ensure("kostnadsstalle", ["MBR:300"]))["MBR:300"]!;
      await db.query(`update public.dimension_values set label = '300 Malmö' where id = $1`, [id]);
      expect(await ensure("kostnadsstalle", ["300 malmö"])).toEqual({ "300 malmö": id });
    });

    it("rejects unknown dimensions", async () => {
      await expect(ensure("finns_inte", ["x"])).rejects.toThrow(/Okänd dimension/);
    });
  });

  describe("merge_dimension_values", () => {
    it("rewrites facts, ledger objects, aliases and saved filters, then deactivates the source", async () => {
      const gbg = await ensureValue(db, "ort", "gbg", "Gbg");
      const goteborg = await ensureValue(db, "ort", "göteborg", "Göteborg");
      const other = await ensureValue(db, "ort", "borås", "Borås");
      const krom = await valueId(db, "verksamhet", "krom");
      await asUser(db, app, (tx) =>
        tx.query(
          `insert into public.dimension_aliases (dimension_id, alias_norm, value_id)
           select dimension_id, 'gôteborg', id from public.dimension_values where id = $1`,
          [gbg],
        ),
      );
      await stageAndPublish(db, app, {
        dataset: "wb_deltagare",
        slices: [{ company: "MBR", month: "2026-09" }],
        facts: [
          {
            metric: "nya_deltagare",
            company: "MBR",
            month: "2026-09",
            dims: { ort: gbg, verksamhet: krom },
            value: 3,
          },
          {
            metric: "nya_deltagare",
            company: "MBR",
            month: "2026-09",
            dims: { ort: goteborg, verksamhet: krom },
            value: 4,
          },
          {
            metric: "nya_deltagare",
            company: "MBR",
            month: "2026-09",
            dims: { ort: other, verksamhet: krom },
            value: 5,
          },
        ],
      });
      const filter = { dimension: "ort", valueIds: [gbg, other] };
      await asUser(db, app, async (tx) => {
        await tx.query(`insert into public.report_templates (name, slides) values ('Mall', $1)`, [
          JSON.stringify([
            { id: "s1", filters: [filter, { dimension: "verksamhet", valueIds: [gbg] }] },
            { id: "s2" },
          ]),
        ]);
        await tx.query(`insert into public.dashboards (name, spec) values ('Start', $1)`, [
          JSON.stringify({ name: "Start", widgets: [{ id: "w1", filters: [filter] }] }),
        ]);
      });

      const res = await rpc<{ r: { facts: number } }>(
        db,
        app,
        `select public.merge_dimension_values($1, $2) r`,
        [gbg, goteborg],
      );
      expect(res[0]?.r.facts).toBe(1);

      const grouped = await rpc<{ grp: { ort: number }; value: string }>(
        db,
        app,
        `select grp, value from public.metric_monthly(array['nya_deltagare'], null, 'utfall', '2026-09-01', '2026-09-01', array['ort'], '[]')`,
      );
      expect(Object.fromEntries(grouped.map((r) => [r.grp.ort, Number(r.value)]))).toEqual({
        [goteborg]: 7,
        [other]: 5,
      });
      expect(await valueRow(gbg)).toMatchObject({ active: false });
      expect(await ensure("ort", ["GBG", "Gbg", "gôteborg"])).toEqual({
        GBG: goteborg,
        Gbg: goteborg,
        gôteborg: goteborg,
      });

      const tpl = await db.query<{
        slides: { filters?: { dimension: string; valueIds: number[] }[] }[];
      }>(`select slides from public.report_templates where name = 'Mall'`);
      expect(tpl.rows[0]?.slides[0]?.filters).toEqual([
        { dimension: "ort", valueIds: [goteborg, other].sort((a, b) => a - b) },
        { dimension: "verksamhet", valueIds: [gbg] },
      ]);
      expect(tpl.rows[0]?.slides[1]).toEqual({ id: "s2" });
      const dash = await db.query<{ spec: { widgets: { filters: { valueIds: number[] }[] }[] } }>(
        `select spec from public.dashboards where name = 'Start'`,
      );
      expect(dash.rows[0]?.spec.widgets[0]?.filters[0]?.valueIds.sort()).toEqual(
        [goteborg, other].sort(),
      );

      const audit = await db.query<{ action: string }>(
        `select action from public.audit_log where entity = 'dimension_value' and entity_id = $1`,
        [String(gbg)],
      );
      expect(audit.rows).toEqual([{ action: "merge" }]);
    });

    it("moves ledger object rows", async () => {
      const a = await ensureValue(db, "kostnadsstalle", "MBR:10", "10 Gamla");
      const b = await ensureValue(db, "kostnadsstalle", "MBR:20", "20 Nya");
      await stageAndPublish(db, app, {
        dataset: "fx_bokforing",
        slices: [{ company: "MBR", month: "2026-03" }],
        ledger: [
          { company: "MBR", month: "2026-03", account: 3010, amount: -100 },
          {
            company: "MBR",
            month: "2026-03",
            account: 3010,
            dimNo: 1,
            objectValueId: a,
            amount: -100,
          },
        ],
      });
      const res = await rpc<{ r: { ledger_rows: number } }>(
        db,
        app,
        `select public.merge_dimension_values($1, $2) r`,
        [a, b],
      );
      expect(res[0]?.r.ledger_rows).toBe(1);
      const rows = await rpc<{ grp: { kostnadsstalle: number | null }; value: string }>(
        db,
        app,
        `select grp, value from public.ledger_monthly(array['intakter'], array['MBR'], '2026-03-01', '2026-03-01', array['kostnadsstalle'])`,
      );
      expect(rows.map((r) => [r.grp.kostnadsstalle, Number(r.value)])).toEqual([[b, 100]]);
    });

    it("refuses invalid merges", async () => {
      const ort = await ensureValue(db, "ort", "växjö", "Växjö");
      const krom = await valueId(db, "verksamhet", "krom");
      const merge = (from: number, into: number) =>
        rpc(db, app, `select public.merge_dimension_values($1, $2)`, [from, into]);
      await expect(merge(ort, ort)).rejects.toThrow(/sig självt/);
      await expect(merge(ort, krom)).rejects.toThrow(/olika dimensioner/);
      await expect(merge(ort, 99999999)).rejects.toThrow(/finns inte/);
    });

    it("refuses to merge into an inactive value (its facts already moved on)", async () => {
      const a = await ensureValue(db, "ort", "lund", "Lund");
      const b = await ensureValue(db, "ort", "lunds kommun", "Lunds kommun");
      const c = await ensureValue(db, "ort", "lund c", "Lund C");
      const merge = (from: number, into: number) =>
        rpc(db, app, `select public.merge_dimension_values($1, $2)`, [from, into]);
      await merge(a, b);
      // c's facts would land on a, while a's own facts already live on b.
      await expect(merge(c, a)).rejects.toThrow(/inaktivt/);
      await expect(merge(c, b)).resolves.toHaveLength(1);
    });

    it("refuses to merge kostnadsställen of different companies", async () => {
      const mbab = await ensureValue(db, "kostnadsstalle", "MBAB:700", "700 Lager");
      const mbr = await ensureValue(db, "kostnadsstalle", "MBR:700", "700 Lager");
      const mbab2 = await ensureValue(db, "kostnadsstalle", "MBAB:701", "701 Lager");
      const merge = (from: number, into: number) =>
        rpc(db, app, `select public.merge_dimension_values($1, $2)`, [from, into]);
      await expect(merge(mbab, mbr)).rejects.toThrow(/olika bolag/);
      await expect(merge(mbab2, mbab)).resolves.toHaveLength(1);
    });
  });
});
