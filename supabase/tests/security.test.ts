import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stage, stageAndPublish, valueId } from "./fixtures";
import { asAnon, asService, asUser, createAppUser, createTestDb, type Db } from "./harness";

const NIL = "00000000-0000-0000-0000-000000000000";

/** Every app RPC with valid-looking arguments. Keep in sync with the migrations. */
const APP_RPCS: Record<string, string> = {
  publish_upload: `select public.publish_upload('${NIL}')`,
  retract_upload: `select public.retract_upload('${NIL}', 'x')`,
  discard_upload: `select public.discard_upload('${NIL}')`,
  discard_stale_uploads: `select public.discard_stale_uploads(24)`,
  review_compare: `select public.review_compare('${NIL}')`,
  metric_monthly: `select * from public.metric_monthly(array['timmar'], null, 'utfall', '2026-01-01', '2026-12-01', '{}', '[]')`,
  metric_distinct: `select * from public.metric_distinct('timmar', 'konsult', null, 'utfall', '2026-01-01', '2026-12-01', '{}', '[]', false)`,
  ledger_monthly: `select * from public.ledger_monthly(array['intakter'], null, '2026-01-01', '2026-12-01', '{}')`,
  metric_coverage: `select * from public.metric_coverage(array['timmar'], null, 'utfall', '2026-01-01', '2026-12-01')`,
  metric_sources: `select * from public.metric_sources(array['timmar'], null, '2026-01-01', '2026-12-01')`,
  ensure_dimension_values: `select * from public.ensure_dimension_values('ort', array['Malmö'])`,
  merge_dimension_values: `select public.merge_dimension_values(1, 2)`,
  freeze_report: `select public.freeze_report('x', null, '2026-09-01', '{"specs": []}')`,
};
/** The only function anon may execute: the free-plan keep-alive ping (reads no data). */
const PUBLIC_RPCS: Record<string, string> = {
  keepalive: `select public.keepalive()`,
};
const SERVICE_RPCS: Record<string, string> = {
  login_gate: `select public.login_gate('abcdef0123456789abcdef')`,
  login_record: `select public.login_record('00000000-0000-4000-8000-000000000000', false)`,
};

/** Luhn check digit for nine digits, giving a valid ten-digit personnummer. */
function withLuhn(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(nine[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return nine + String((10 - (sum % 10)) % 10);
}

describe("security", () => {
  let db: Db;
  let app: string;
  let stranger: string;
  let tables: string[];

  beforeAll(async () => {
    db = await createTestDb();
    app = await createAppUser(db);
    stranger = await createAppUser(db, { allowlisted: false });
    tables = (
      await db.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' order by 1`,
      )
    ).rows.map((r) => r.relname);
    // Some data in every interesting table.
    const kund = await valueId(db, "verksamhet", "krom");
    await stageAndPublish(db, app, {
      dataset: "ip_timmar",
      slices: [{ company: "MBAB", month: "2026-09" }],
      facts: [
        {
          metric: "timmar",
          company: "MBAB",
          month: "2026-09",
          dims: { verksamhet: kund },
          value: 10,
        },
      ],
    });
    await asUser(db, app, (tx) =>
      tx.query(
        `select public.freeze_report('Styrelsen', null, '2026-09-01', '{"schemaVersion": 1, "slides": [], "specs": []}')`,
      ),
    );
  });
  afterAll(async () => {
    await db.close();
  });

  it("covers every public function in the RPC lists", async () => {
    const res = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' order by 1`,
    );
    expect(res.rows.map((r) => r.proname)).toEqual(
      Object.keys({ ...APP_RPCS, ...SERVICE_RPCS, ...PUBLIC_RPCS }).sort(),
    );
  });

  describe("anon", () => {
    it("cannot read any public table", async () => {
      for (const table of tables) {
        await expect(
          asAnon(db, (tx) => tx.query(`select * from public.${table}`)),
          table,
        ).rejects.toThrow(/permission denied/);
      }
    });

    it("can only ping keepalive, which returns the time and nothing else", async () => {
      const res = await asAnon(db, (tx) =>
        tx.query<{ t: string }>("select public.keepalive() as t"),
      );
      expect(res.rows).toHaveLength(1);
      expect(Object.keys(res.rows[0] ?? {})).toEqual(["t"]);
    });

    it("cannot call any other RPC", async () => {
      for (const [name, sql] of Object.entries({ ...APP_RPCS, ...SERVICE_RPCS })) {
        await expect(
          asAnon(db, (tx) => tx.query(sql)),
          name,
        ).rejects.toThrow(/permission denied for function/);
      }
    });
  });

  describe("an authenticated user who is not allowlisted", () => {
    it("sees no rows in any public table", async () => {
      for (const table of tables) {
        const res = await asUser(db, stranger, (tx) =>
          tx.query<{ n: number }>(`select count(*)::int as n from public.${table}`),
        );
        expect(res.rows[0]?.n, table).toBe(0);
      }
    });

    it("cannot call app RPCs", async () => {
      for (const [name, sql] of Object.entries(APP_RPCS)) {
        await expect(
          asUser(db, stranger, (tx) => tx.query(sql)),
          name,
        ).rejects.toThrow(/Behörighet saknas/);
      }
    });

    it("cannot write reference data or allowlist itself", async () => {
      await expect(
        asUser(db, stranger, (tx) =>
          tx.query(`insert into public.settings (key, value) values ('x_key', '1')`),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asUser(db, stranger, (tx) =>
          tx.query(`insert into public.app_users (user_id) values ($1)`, [stranger]),
        ),
      ).rejects.toThrow(/permission denied/);
      const updated = await asUser(db, stranger, (tx) =>
        tx.query(`update public.settings set value = '99' where key = 'deviation_threshold_pct'`),
      );
      expect(updated.affectedRows).toBe(0);
    });
  });

  describe("an allowlisted user", () => {
    it("reads reference data and facts", async () => {
      const res = await asUser(db, app, (tx) =>
        tx.query<{ companies: number; facts: number; me: number }>(
          `select (select count(*)::int from public.companies) as companies,
                  (select count(*)::int from public.metric_values) as facts,
                  (select count(*)::int from public.app_users) as me`,
        ),
      );
      expect(res.rows[0]).toEqual({ companies: 2, facts: 1, me: 1 });
    });

    it("can call the read RPCs", async () => {
      const res = await asUser(db, app, (tx) =>
        tx.query<{ value: string }>(APP_RPCS.metric_monthly!),
      );
      expect(res.rows.map((r) => Number(r.value))).toEqual([10]);
    });

    it("cannot call the login throttle RPCs", async () => {
      for (const [name, sql] of Object.entries(SERVICE_RPCS)) {
        await expect(
          asUser(db, app, (tx) => tx.query(sql)),
          name,
        ).rejects.toThrow(/permission denied for function/);
      }
    });

    it("cannot add users to the allowlist", async () => {
      const other = await createAppUser(db, { allowlisted: false });
      await expect(
        asUser(db, app, (tx) =>
          tx.query(`insert into public.app_users (user_id) values ($1)`, [other]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("facts and uploads", () => {
    for (const table of [
      "metric_values",
      "uploads",
      "upload_slices",
      "ledger_balances",
      "board_reports",
      "audit_log",
    ]) {
      it(`cannot be deleted or truncated from ${table}`, async () => {
        await expect(
          asUser(db, app, (tx) => tx.query(`delete from public.${table}`)),
        ).rejects.toThrow(/permission denied/);
        await expect(
          asUser(db, app, (tx) => tx.query(`truncate public.${table} cascade`)),
        ).rejects.toThrow(/permission denied/);
        await expect(
          asService(db, (tx) => tx.query(`delete from public.${table}`)),
        ).rejects.toThrow(/permission denied/);
      });
    }

    it("cannot be updated directly (status and is_current move only through RPCs)", async () => {
      for (const sql of [
        `update public.uploads set status = 'published'`,
        `update public.upload_slices set is_current = true`,
        `update public.metric_values set value = 0`,
        `update public.ledger_balances set amount = 0`,
      ]) {
        await expect(
          asUser(db, app, (tx) => tx.query(sql)),
          sql,
        ).rejects.toThrow(/permission denied/);
      }
    });

    it("cannot be inserted as published or current", async () => {
      await expect(
        asUser(db, app, (tx) =>
          tx.query(
            `insert into public.uploads (dataset_id, scenario, file_name, file_sha256, file_size,
               content_hash, engine_version, status, published_at)
             values (1, 'utfall', 'x.xlsx', repeat('a', 64), 1, repeat('b', 64), 1, 'published', now())`,
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      const uploadId = await stage(db, app, {
        dataset: "ip_timmar",
        slices: [{ company: "MBAB", month: "2026-10" }],
      });
      await expect(
        asUser(db, app, (tx) =>
          tx.query(
            `insert into public.upload_slices (upload_id, dataset_id, company_id, scenario, month, is_current)
             values ($1, 1, 2, 'utfall', '2026-10-01', true)`,
            [uploadId],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("cannot stage rows into a published upload", async () => {
      const { id } = await stageAndPublish(db, app, {
        dataset: "ip_timmar",
        slices: [{ company: "MBR", month: "2026-09" }],
      });
      await expect(
        asUser(db, app, (tx) =>
          tx.query(
            `insert into public.metric_values (upload_id, metric_id, company_id, month, value)
             values ($1, (select id from public.metrics where key = 'timmar'), 2, '2026-09-01', 5)`,
            [id],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("audit log", () => {
    it("stamps the caller and the database time, whatever the client sends", async () => {
      const other = await createAppUser(db);
      const res = await asUser(db, app, (tx) =>
        tx.query<{ actor: string; recent: boolean }>(
          `insert into public.audit_log (at, actor, action, entity)
           values ('2001-01-01T00:00:00Z', $1, 'forged', 'upload')
           returning actor, at > now() - interval '1 minute' as recent`,
          [other],
        ),
      );
      expect(res.rows).toEqual([{ actor: app, recent: true }]);
    });
  });

  describe("frozen board reports", () => {
    it("are immutable, even for the table owner", async () => {
      const id = (await db.query<{ id: string }>(`select id from public.board_reports limit 1`))
        .rows[0]!.id;
      await expect(
        asUser(db, app, (tx) =>
          tx.query(`update public.board_reports set title = 'Ändrad' where id = $1`, [id]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`update public.board_reports set title = 'Ändrad' where id = $1`, [id]),
      ).rejects.toThrow(/kan inte ändras/);
      await expect(
        db.query(`delete from public.board_reports where id = $1`, [id]),
      ).rejects.toThrow(/kan inte ändras/);
      await expect(db.query(`truncate public.board_reports cascade`)).rejects.toThrow(
        /kan inte ändras/,
      );
      await expect(db.query(`update public.audit_log set action = 'x'`)).rejects.toThrow(
        /kan inte ändras/,
      );
    });

    it("reject snapshots that group or filter by a personal dimension", async () => {
      const freeze = (specs: unknown) =>
        asUser(db, app, (tx) =>
          tx.query(`select public.freeze_report('R', null, '2026-09-01', $1::jsonb) as id`, [
            JSON.stringify({ schemaVersion: 1, slides: [], specs }),
          ]),
        );
      const spec = {
        id: "s1",
        viz: "bar",
        metricKey: "timmar",
        grain: "month",
        company: "ALL",
        filters: [],
      };
      await expect(freeze([{ ...spec, groupBy: "konsult" }])).rejects.toThrow(
        /Personliga dimensioner/,
      );
      await expect(
        freeze([{ ...spec, groupBy: "kund", filters: [{ dimension: "konsult", valueIds: [1] }] }]),
      ).rejects.toThrow(/Personliga dimensioner/);
      await expect(
        asUser(db, app, (tx) =>
          tx.query(`select public.freeze_report('R', null, '2026-09-01', '{"slides": []}')`),
        ),
      ).rejects.toThrow(/saknar bildspecifikationer/);
      const ok = await freeze([
        { ...spec, groupBy: "kund", filters: [{ dimension: "verksamhet", valueIds: [1] }] },
      ]);
      expect(ok.rows).toHaveLength(1);
    });

    it("reject snapshots with slides that have no spec (specs cannot be left out)", async () => {
      const freeze = (snapshot: unknown) =>
        asUser(db, app, (tx) =>
          tx.query(`select public.freeze_report('R', null, '2026-09-01', $1::jsonb) as id`, [
            JSON.stringify(snapshot),
          ]),
        );
      const spec = { id: "s1", viz: "table", metricKey: "timmar", groupBy: "kund", filters: [] };
      // A konsult breakdown resolved client-side but frozen with an empty specs array.
      await expect(
        freeze({ schemaVersion: 1, slides: [{ id: "s1", table: { rows: [] } }], specs: [] }),
      ).rejects.toThrow(/bildspecifikation/);
      await expect(
        freeze({ schemaVersion: 1, slides: [{ id: "s2" }], specs: [spec] }),
      ).rejects.toThrow(/bildspecifikation/);
      await expect(freeze({ schemaVersion: 1, slides: [{}], specs: [spec] })).rejects.toThrow(
        /bildspecifikation/,
      );
      await expect(freeze({ schemaVersion: 1, specs: [spec] })).rejects.toThrow(/saknar bilder/);
      const ok = await freeze({ schemaVersion: 1, slides: [{ id: "s1" }], specs: [spec] });
      expect(ok.rows).toHaveLength(1);
    });

    it("report templates cannot reference personal dimensions either", async () => {
      await expect(
        asUser(db, app, (tx) =>
          tx.query(`insert into public.report_templates (name, slides) values ('M', $1::jsonb)`, [
            JSON.stringify([{ id: "a", groupBy: "konsult", filters: [] }]),
          ]),
        ),
      ).rejects.toThrow(/Personliga dimensioner/);
    });
  });

  describe("personnummer", () => {
    const pnr10 = withLuhn("811218987");
    const samordning = withLuhn("811278987");
    const cases: [string, string][] = [
      ["YYMMDD-NNNN", `${pnr10.slice(0, 6)}-${pnr10.slice(6)}`],
      ["YYMMDDNNNN", pnr10],
      ["YYYYMMDD-NNNN", `19${pnr10.slice(0, 6)}-${pnr10.slice(6)}`],
      ["YYYYMMDDNNNN", `19${pnr10}`],
      ["YYMMDD+NNNN", `${pnr10.slice(0, 6)}+${pnr10.slice(6)}`],
      ["samordningsnummer", samordning],
      ["inside text", `Anna Svensson ${pnr10.slice(0, 6)}-${pnr10.slice(6)} (KROM)`],
      ["YYMMDD NNNN", `${pnr10.slice(0, 6)} ${pnr10.slice(6)}`],
      ["YYYYMMDD NNNN", `19${pnr10.slice(0, 6)} ${pnr10.slice(6)}`],
      ["YYMMDD\u00A0NNNN", `${pnr10.slice(0, 6)}\u00A0${pnr10.slice(6)}`],
      ["YYYYMMDD\u00A0NNNN", `19${pnr10.slice(0, 6)}\u00A0${pnr10.slice(6)}`],
      ["YYMMDD\u202FNNNN", `${pnr10.slice(0, 6)}\u202F${pnr10.slice(6)}`],
      ["spaced inside text", `Anna Svensson 19${pnr10.slice(0, 6)} ${pnr10.slice(6)} (KROM)`],
    ];

    for (const [name, value] of cases) {
      it(`is rejected in dimension_values and aliases (${name})`, async () => {
        const insertValue = (code: string, label: string) =>
          asUser(db, app, (tx) =>
            tx.query(
              `insert into public.dimension_values (dimension_id, code, label)
               select id, $1, $2 from public.dimensions where key = 'ort'`,
              [code, label],
            ),
          );
        await expect(insertValue(value, "Ort")).rejects.toThrow(/Personnummer får inte sparas/);
        await expect(insertValue(`ort-${name}`, value)).rejects.toThrow(
          /Personnummer får inte sparas/,
        );
        await expect(
          asUser(db, app, (tx) =>
            tx.query(
              `insert into public.dimension_aliases (dimension_id, alias_norm, value_id)
               select d.id, $1, dv.id from public.dimension_values dv
               join public.dimensions d on d.id = dv.dimension_id
               where d.key = 'verksamhet' and dv.code = 'krom'`,
              [value],
            ),
          ),
        ).rejects.toThrow(/Personnummer får inte sparas/);
        await expect(
          asUser(db, app, (tx) =>
            tx.query(`select * from public.ensure_dimension_values('ort', array[$1])`, [value]),
          ),
        ).rejects.toThrow(/Personnummer får inte sparas/);
      });
    }

    it("allows exactly one separator between date and serial", async () => {
      const contains = async (text: string) =>
        (await db.query<{ r: boolean }>(`select private.contains_personnummer($1) as r`, [text]))
          .rows[0]?.r;
      const [date, serial] = [pnr10.slice(0, 6), pnr10.slice(6)];
      for (const sep of ["", "-", "+", " ", " ", " "]) {
        expect(await contains(`${date}${sep}${serial}`), JSON.stringify(sep)).toBe(true);
      }
      for (const sep of ["u", "a", "\t", "  ", "--", "/"]) {
        expect(await contains(`${date}${sep}${serial}`), JSON.stringify(sep)).toBe(false);
      }
    });

    it("never echoes the number in the error", async () => {
      const error = await asUser(db, app, (tx) =>
        tx.query(
          `insert into public.dimension_values (dimension_id, code, label)
           select id, 'x-pnr', $1 from public.dimensions where key = 'ort'`,
          [pnr10],
        ),
      ).catch((e: Error) => e);
      expect(String((error as Error).message)).not.toContain(pnr10.slice(0, 6));
    });

    it("is rejected in upload file names and parse reports", async () => {
      const insertUpload = (fileName: string, report: unknown) =>
        asUser(db, app, (tx) =>
          tx.query(
            `insert into public.uploads (dataset_id, scenario, file_name, file_sha256, file_size,
               content_hash, engine_version, parse_report)
             values (1, 'utfall', $1, repeat('a', 64), 1, repeat('b', 64), 1, $2)`,
            [fileName, JSON.stringify(report)],
          ),
        );
      await expect(insertUpload(`lön ${pnr10}.xlsx`, {})).rejects.toThrow(
        /Personnummer får inte sparas/,
      );
      await expect(
        insertUpload("timmar.xlsx", { issues: [{ sourceRow: 3, value: pnr10 }] }),
      ).rejects.toThrow(/Personnummer får inte sparas/);
      await expect(
        insertUpload("timmar 556959-9318.xlsx", { rowsRead: 10 }),
      ).resolves.toBeDefined();
    });

    it("rejects updates to a personnummer", async () => {
      const id = await valueId(db, "verksamhet", "kvl");
      await expect(
        asUser(db, app, (tx) =>
          tx.query(`update public.dimension_values set label = $1 where id = $2`, [pnr10, id]),
        ),
      ).rejects.toThrow(/Personnummer får inte sparas/);
    });

    it("accepts organisation numbers, invalid dates, bad checksums and other digits", async () => {
      const bad = pnr10.slice(0, 9) + String((Number(pnr10[9]) + 1) % 10);
      for (const ok of [
        "556959-9318",
        "5569599318",
        "165569599318",
        "559208-9071",
        "556959 9318",
        "559208\u00A09071",
        bad,
        `${bad.slice(0, 6)} ${bad.slice(6)}`,
        "811232-1234",
        "Uppdrag 2026-09 nr 12345",
        "12345678901",
      ]) {
        const res = await asUser(db, app, (tx) =>
          tx.query<{ id: number }>(
            `select id from public.ensure_dimension_values('uppdrag', array[$1])`,
            [ok],
          ),
        );
        expect(res.rows[0]?.id, ok).not.toBeNull();
      }
    });
  });
});
