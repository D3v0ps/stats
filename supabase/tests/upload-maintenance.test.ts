// Deleting import templates that uploads used, and cleaning up staged uploads that were
// left behind (discard_stale_uploads), through the repo adapters and RPCs as the app does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImportTemplate } from "@/lib/contracts/pipeline";
import { SupabaseMetricDataSource } from "@/lib/db/repo/metrics";
import type { DbClient } from "@/lib/db/repo/shared";
import { createTemplate, createTemplateVersion, deleteTemplate } from "@/lib/db/repo/templates";
import { discardStaleUploads, listUploads, retractUpload } from "@/lib/db/repo/uploads";
import { currentSlices, publish, rpc, stage, stageAndPublish, valueId } from "./fixtures";
import { asAnon, asUser, createAppUser, createTestDb, type Db } from "./harness";
import { pgClient } from "./pg-client";

const TEMPLATE: ImportTemplate = {
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
};

interface UploadRow {
  status: string;
  template_id: string | null;
  template_version: number | null;
}

describe("upload maintenance", () => {
  let db: Db;
  let app: string;
  let client: DbClient;
  let krom: number;

  const timmar = (month: string, value: number, extra: Record<string, unknown> = {}) => ({
    dataset: "ip_timmar",
    slices: [{ company: "MBAB" as const, month }],
    facts: [
      { metric: "timmar", company: "MBAB" as const, month, dims: { verksamhet: krom }, value },
    ],
    ...extra,
  });

  const upload = async (id: string) =>
    (
      await db.query<UploadRow>(
        "select status, template_id, template_version from public.uploads where id = $1",
        [id],
      )
    ).rows[0];

  const hoursIn = async (month: string) => {
    const rows = await new SupabaseMetricDataSource(client).monthly(["timmar"], {
      companies: ["MBAB"],
      scenario: "utfall",
      from: month,
      to: month,
      groupBy: [],
      filters: [],
    });
    return rows.map((r) => r.value);
  };

  beforeAll(async () => {
    db = await createTestDb();
    app = await createAppUser(db);
    client = pgClient(db, app);
    krom = await valueId(db, "verksamhet", "krom");
  });
  afterAll(async () => {
    await db.close();
  });

  describe("deleting an import template", () => {
    it("keeps its uploads, their data current and the version as history", async () => {
      const template = await createTemplate(client, TEMPLATE);
      expect(await createTemplateVersion(client, template.id, { config: TEMPLATE.config })).toBe(2);
      const same = { file: "timmar-aug.xlsx", templateId: template.id };
      // The same file through both versions: both stay published.
      const v1 = await stageAndPublish(
        db,
        app,
        timmar("2026-08", 5, { ...same, templateVersion: 1 }),
      );
      const v2 = await stageAndPublish(
        db,
        app,
        timmar("2026-08", 7, { ...same, templateVersion: 2 }),
      );
      const older = await stageAndPublish(
        db,
        app,
        timmar("2026-07", 3, {
          file: "timmar-jul.xlsx",
          templateId: template.id,
          templateVersion: 1,
        }),
      );
      const staged = await stage(
        db,
        app,
        timmar("2026-09", 9, {
          file: "timmar-sep.xlsx",
          templateId: template.id,
          templateVersion: 2,
        }),
      );
      const before = await currentSlices(db, "ip_timmar");

      await deleteTemplate(client, template.id);

      const left = await db.query<{ n: number }>(
        `select (select count(*) from public.import_templates where id = $1)
           + (select count(*) from public.import_template_versions where template_id = $1) as n`,
        [template.id],
      );
      expect(Number(left.rows[0]?.n)).toBe(0);
      expect(await upload(v1.id)).toEqual({
        status: "published",
        template_id: null,
        template_version: 1,
      });
      expect(await upload(v2.id)).toEqual({
        status: "published",
        template_id: null,
        template_version: 2,
      });
      expect(await upload(staged)).toEqual({
        status: "staged",
        template_id: null,
        template_version: 2,
      });
      expect(await currentSlices(db, "ip_timmar")).toEqual(before);
      expect(await hoursIn("2026-08")).toEqual([7]);
      expect(await hoursIn("2026-07")).toEqual([3]);

      const history = await listUploads(client, { ids: [v1.id, v2.id, older.id, staged] });
      expect(history.map((u) => u.templateId)).toEqual([null, null, null, null]);
      const sources = await rpc<{
        upload_id: string;
        template_name: string | null;
        template_version: number | null;
      }>(
        db,
        app,
        `select upload_id, template_name, template_version
         from public.metric_sources(array['timmar'], array['MBAB'], '2026-07-01', '2026-08-01')`,
      );
      // A version without its template names nothing the reader can look up.
      expect(sources.map((s) => [s.template_name, s.template_version])).toEqual([
        [null, null],
        [null, null],
      ]);

      // The upload staged with the deleted template can still be reviewed and published.
      const review = await rpc<{ r: { rows: { metric_key: string; staged: number }[] } }>(
        db,
        app,
        "select public.review_compare($1) r",
        [staged],
      );
      expect(review[0]?.r.rows.find((r) => r.metric_key === "timmar")?.staged).toBe(9);
      await expect(publish(db, app, staged)).resolves.toMatchObject({ current: 1 });
      expect(await hoursIn("2026-09")).toEqual([9]);

      // Retracting version 2 brings version 1 back, as before the delete.
      await retractUpload(client, v2.id, "fel version");
      expect(await hoursIn("2026-08")).toEqual([5]);
      expect((await currentSlices(db, "ip_timmar"))["MBAB:utfall:2026-08"]).toBe(v1.id);
    });

    it("lets the same file be published again through a new template", async () => {
      const first = await createTemplate(client, TEMPLATE);
      const file = { file: "timmar-jun.xlsx" };
      await stageAndPublish(
        db,
        app,
        timmar("2026-06", 4, { ...file, templateId: first.id, templateVersion: 1 }),
      );
      await deleteTemplate(client, first.id);
      const next = await createTemplate(client, TEMPLATE);
      const again = await stageAndPublish(
        db,
        app,
        timmar("2026-06", 6, { ...file, templateId: next.id, templateVersion: 1 }),
      );
      expect(again.summary.current).toBe(1);
      const dup = await stage(
        db,
        app,
        timmar("2026-06", 6, { ...file, templateId: next.id, templateVersion: 1 }),
      );
      await expect(publish(db, app, dup)).rejects.toThrow(/redan publicerad/);
    });

    it("still allows a file without a template (SIE) to be published only once", async () => {
      const sie = {
        dataset: "fx_bokforing",
        file: "mbab-2025.se",
        slices: [{ company: "MBAB" as const, month: "2025-03" }],
        ledger: [{ company: "MBAB" as const, month: "2025-03", account: 3010, amount: -100 }],
      };
      await stageAndPublish(db, app, sie);
      const dup = await stage(db, app, sie);
      await expect(publish(db, app, dup)).rejects.toThrow(/redan publicerad/);
      // The unique index backs the publish check up for uploads without a template.
      await expect(
        db.query(
          `update public.uploads set status = 'published', published_at = now() where id = $1`,
          [dup],
        ),
      ).rejects.toThrow(/uploads_published_file_uniq/);
    });

    it("never cuts an upload's link to a template that still exists (versions are immutable)", async () => {
      const template = await createTemplate(client, TEMPLATE);
      const used = await stageAndPublish(
        db,
        app,
        timmar("2026-04", 2, {
          file: "timmar-apr.xlsx",
          templateId: template.id,
          templateVersion: 1,
        }),
      );
      // Deleting one version (not the template) would null template_id through the foreign key.
      await expect(
        asUser(db, app, (tx) =>
          tx.query("delete from public.import_template_versions where template_id = $1", [
            template.id,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
      expect(await upload(used.id)).toEqual({
        status: "published",
        template_id: template.id,
        template_version: 1,
      });
      // Deleting the whole template still takes its versions with it.
      await deleteTemplate(client, template.id);
      expect(await upload(used.id)).toEqual({
        status: "published",
        template_id: null,
        template_version: 1,
      });
    });

    it("does not let clients stage a template version without a template", async () => {
      await expect(
        stage(db, app, timmar("2026-05", 1, { templateId: null, templateVersion: 3 })),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("discard_stale_uploads", () => {
    const age = (ids: string[], hours: number) =>
      db.query(
        `update public.uploads set created_at = now() - make_interval(hours => $2)
         where id = any($1::uuid[])`,
        [ids, hours],
      );
    const discardStale = async (hours?: number) =>
      (
        await rpc<{ n: number }>(
          db,
          app,
          hours === undefined
            ? "select public.discard_stale_uploads() n"
            : "select public.discard_stale_uploads($1) n",
          hours === undefined ? [] : [hours],
        )
      )[0]?.n;

    it("discards staged uploads older than 24 hours like discard_upload, and counts them", async () => {
      const old = [
        await stage(db, app, timmar("2025-01", 1)),
        await stage(db, app, timmar("2025-02", 2)),
      ];
      const young = await stage(db, app, timmar("2025-03", 3));
      const published = await stageAndPublish(db, app, timmar("2025-04", 4));
      await age([...old, published.id], 30);
      await age([young], 23);

      expect(await discardStale()).toBe(2);
      for (const id of old) expect((await upload(id))?.status).toBe("discarded");
      expect((await upload(young))?.status).toBe("staged");
      expect((await upload(published.id))?.status).toBe("published");
      const facts = await db.query<{ n: number }>(
        "select count(*)::int as n from public.metric_values where upload_id = any($1::uuid[])",
        [old],
      );
      expect(facts.rows[0]?.n).toBe(0);
      const audit = await db.query<{ entity_id: string }>(
        `select entity_id from public.audit_log
         where action = 'discard' and entity_id = any($1::text[]) order by entity_id`,
        [old],
      );
      expect(audit.rows.map((r) => r.entity_id)).toEqual([...old].sort());
      expect(await hoursIn("2025-04")).toEqual([4]);

      expect(await discardStale()).toBe(0);
      expect(await discardStale(24)).toBe(0);
      expect(await discardStale(22)).toBe(1);
      expect((await upload(young))?.status).toBe("discarded");
    });

    it("is reachable through the repo adapter", async () => {
      const id = await stage(db, app, timmar("2025-05", 5));
      await age([id], 3);
      expect(await discardStaleUploads(client, 4)).toBe(0);
      expect(await discardStaleUploads(client, 2)).toBe(1);
      expect((await upload(id))?.status).toBe("discarded");
    });

    it("refuses a threshold under an hour", async () => {
      for (const hours of [0, -1]) {
        await expect(discardStale(hours)).rejects.toThrow(/minst en timme/);
      }
      await expect(rpc(db, app, "select public.discard_stale_uploads(null)")).rejects.toThrow(
        /minst en timme/,
      );
    });

    it("refuses users who are not allowlisted, and anon", async () => {
      const id = await stage(db, app, timmar("2025-06", 6));
      await age([id], 48);
      const stranger = await createAppUser(db, { allowlisted: false });
      await expect(
        asUser(db, stranger, (tx) => tx.query("select public.discard_stale_uploads()")),
      ).rejects.toThrow(/Behörighet saknas/);
      await expect(
        asAnon(db, (tx) => tx.query("select public.discard_stale_uploads()")),
      ).rejects.toThrow(/permission denied/);
      expect((await upload(id))?.status).toBe("staged");
    });
  });
});
