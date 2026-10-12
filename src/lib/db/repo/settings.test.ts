import { describe, expect, it } from "vitest";
import { createFakeClient } from "./fake-client";
import {
  closePeriod,
  getSettings,
  listClosedPeriods,
  reopenPeriod,
  setDeviationThresholdPct,
  toAppSettings,
} from "./settings";
import { catalogTables } from "./test-fixtures";

describe("settings", () => {
  it("reads typed settings with database defaults as fallback", async () => {
    const { client } = createFakeClient({ tables: catalogTables() });
    expect(await getSettings(client)).toEqual({
      deviationThresholdPct: 25,
      minEngineVersion: 1,
      raw: { deviation_threshold_pct: 25, min_engine_version: 1 },
    });
    expect(toAppSettings([])).toMatchObject({ deviationThresholdPct: 25, minEngineVersion: 1 });
    expect(
      toAppSettings([{ key: "deviation_threshold_pct", value: "30" }]).deviationThresholdPct,
    ).toBe(30);
    expect(
      toAppSettings([{ key: "deviation_threshold_pct", value: { x: 1 } }]).deviationThresholdPct,
    ).toBe(25);
  });

  it("validates and stores the deviation threshold", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await setDeviationThresholdPct(client, 40);
    expect(tables.settings?.find((s) => s.key === "deviation_threshold_pct")?.value).toBe(40);
    await expect(setDeviationThresholdPct(client, 0)).rejects.toThrow(/mellan 0 och 1000/);
    await expect(setDeviationThresholdPct(client, Number.NaN)).rejects.toThrow();
  });
});

describe("period close", () => {
  it("closes, lists and reopens months per company", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await closePeriod(client, "MBR", "2026-09");
    expect(tables.period_status).toEqual([{ company_id: 2, month: "2026-09-01" }]);
    tables.period_status![0]!.closed_at = "2026-10-05T10:00:00Z";
    expect(await listClosedPeriods(client)).toEqual([
      { company: "MBR", month: "2026-09", closedAt: "2026-10-05T10:00:00Z" },
    ]);
    await reopenPeriod(client, "MBR", "2026-09");
    expect(tables.period_status).toEqual([]);
  });
});
