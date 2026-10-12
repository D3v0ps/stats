import { describe, expect, it } from "vitest";
import type { ResolvedReport, SlideSpec } from "@/lib/contracts/slides";
import { createFakeClient } from "./fake-client";
import {
  buildSnapshot,
  createReportTemplate,
  freezeReport,
  getFrozenReport,
  listFrozenReports,
  listReportTemplates,
  toFrozenReport,
  updateReportTemplate,
} from "./reports";

const spec: SlideSpec = {
  id: "s1",
  viz: "kpi",
  metricKey: "aktiva_deltagare",
  grain: "month",
  company: "ALL",
  groupBy: null,
  filters: [],
  compare: "prev_period",
  topN: null,
  headline: null,
  notes: "",
};

const report: ResolvedReport = {
  schemaVersion: 1,
  title: "Styrelsemöte oktober",
  anchorMonth: "2026-09",
  periodLabel: "september 2026",
  generatedAt: "2026-10-12T08:00:00Z",
  slides: [],
};

describe("report templates", () => {
  it("validates slides and maps rows", async () => {
    const { client, tables } = createFakeClient();
    const created = await createReportTemplate(client, { name: "Månadsrapport", slides: [spec] });
    expect(created).toMatchObject({ name: "Månadsrapport", slides: [spec] });
    expect(tables.report_templates?.[0]).toMatchObject({ name: "Månadsrapport", slides: [spec] });
    const updated = await updateReportTemplate(client, created.id, { name: "Ny", slides: [] });
    expect(updated.name).toBe("Ny");
    expect(await listReportTemplates(client)).toHaveLength(1);
    await expect(createReportTemplate(client, { name: "", slides: [] })).rejects.toThrow();
  });
});

describe("frozen reports", () => {
  it("freezes the resolved report together with its specs", async () => {
    let args: Record<string, unknown> = {};
    const { client } = createFakeClient({
      rpc: {
        freeze_report: (a) => {
          args = a;
          return "b1";
        },
      },
    });
    expect(
      await freezeReport(client, { title: "  Oktober ", templateId: null, report, specs: [spec] }),
    ).toBe("b1");
    expect(args).toEqual({
      p_title: "Oktober",
      p_template_id: null,
      p_anchor: "2026-09-01",
      p_snapshot: { ...report, specs: [spec] },
    });
    await expect(
      freezeReport(client, { title: " ", templateId: null, report, specs: [] }),
    ).rejects.toThrow(/titel/);
  });

  it("splits a snapshot back into report and specs", () => {
    const frozen = toFrozenReport({
      id: "b1",
      title: "Oktober",
      template_id: null,
      anchor_month: "2026-09-01",
      schema_version: 1,
      frozen_at: "2026-10-12T09:00:00Z",
      snapshot: buildSnapshot(report, [spec]) as never,
    });
    expect(frozen).toEqual({
      id: "b1",
      title: "Oktober",
      templateId: null,
      anchorMonth: "2026-09",
      schemaVersion: 1,
      frozenAt: "2026-10-12T09:00:00Z",
      report,
      specs: [spec],
    });
    expect(() =>
      toFrozenReport({
        id: "b2",
        title: "x",
        template_id: null,
        anchor_month: "2026-09-01",
        schema_version: 2,
        frozen_at: "",
        snapshot: { schemaVersion: 2 },
      }),
    ).toThrow(/okänd snapshot-version/);
  });

  it("still reads a frozen report whose stored specs no longer match today's schema", () => {
    // Frozen reports are immutable; the rendered ResolvedReport must stay readable when
    // SlideSpecSchema evolves. The specs are metadata only.
    const frozen = toFrozenReport({
      id: "b3",
      title: "Gammal",
      template_id: null,
      anchor_month: "2026-09-01",
      schema_version: 1,
      frozen_at: "2026-10-12T09:00:00Z",
      snapshot: {
        ...report,
        specs: [{ id: "s1", viz: "sparkline", metricKey: "timmar" }],
      } as never,
    });
    expect(frozen.report).toEqual(report);
    expect(frozen.specs).toEqual([]);
  });

  it("lists frozen reports without snapshots and gets one", async () => {
    const { client, calls } = createFakeClient({
      tables: {
        board_reports: [
          {
            id: "b1",
            title: "A",
            template_id: null,
            anchor_month: "2026-08-01",
            schema_version: 1,
            frozen_at: "2026-09-10T00:00:00Z",
            snapshot: buildSnapshot(report, []),
          },
          {
            id: "b2",
            title: "B",
            template_id: "t",
            anchor_month: "2026-09-01",
            schema_version: 1,
            frozen_at: "2026-10-10T00:00:00Z",
            snapshot: buildSnapshot(report, [spec]),
          },
        ],
      },
    });
    expect((await listFrozenReports(client)).map((r) => [r.id, r.anchorMonth])).toEqual([
      ["b2", "2026-09"],
      ["b1", "2026-08"],
    ]);
    expect(calls[0]?.kind).toBe("select");
    expect((await getFrozenReport(client, "b2"))?.specs).toEqual([spec]);
    expect(await getFrozenReport(client, "missing")).toBeNull();
  });
});
