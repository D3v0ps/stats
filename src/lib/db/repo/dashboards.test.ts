import { describe, expect, it } from "vitest";
import type { DashboardSpec } from "@/lib/contracts/dashboard";
import {
  createDashboard,
  deleteDashboard,
  getDefaultDashboard,
  listDashboards,
  setDefaultDashboard,
  updateDashboard,
} from "./dashboards";
import { createFakeClient } from "./fake-client";

const spec = (name: string): DashboardSpec => ({
  name,
  widgets: [
    {
      id: "w1",
      title: null,
      viz: "kpi",
      metricKey: "timmar",
      company: null,
      groupBy: null,
      filters: [],
      topN: null,
      layout: { x: 0, y: 0, w: 3, h: 2 },
    },
  ],
});

describe("dashboards", () => {
  it("creates, updates and lists dashboards with the default first", async () => {
    const { client } = createFakeClient();
    const a = await createDashboard(client, spec("Ekonomi"));
    const b = await createDashboard(client, spec("Start"), { isDefault: true });
    expect(a.isDefault).toBe(false);
    expect((await listDashboards(client)).map((d) => d.name)).toEqual(["Start", "Ekonomi"]);
    expect((await getDefaultDashboard(client))?.id).toBe(b.id);
    expect((await updateDashboard(client, a.id, spec("Ekonomi 2"))).spec.name).toBe("Ekonomi 2");
  });

  it("clears the previous default before setting a new one", async () => {
    const { client, calls, tables } = createFakeClient();
    const a = await createDashboard(client, spec("A"), { isDefault: true });
    const b = await createDashboard(client, spec("B"));
    calls.length = 0;
    await setDefaultDashboard(client, b.id);
    expect(calls.map((c) => [c.kind, c.payload])).toEqual([
      ["update", { is_default: false }],
      ["update", { is_default: true }],
    ]);
    expect(Object.fromEntries(tables.dashboards!.map((d) => [d.id, d.is_default]))).toEqual({
      [a.id]: false,
      [b.id]: true,
    });
  });

  it("validates specs and deletes", async () => {
    const { client, tables } = createFakeClient();
    await expect(createDashboard(client, { name: "", widgets: [] })).rejects.toThrow();
    const a = await createDashboard(client, spec("A"));
    await deleteDashboard(client, a.id);
    expect(tables.dashboards).toEqual([]);
    expect(await getDefaultDashboard(client)).toBeNull();
  });
});
