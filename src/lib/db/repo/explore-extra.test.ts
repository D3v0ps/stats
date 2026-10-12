import { describe, expect, it } from "vitest";
import { listMetricSources } from "./explore-extra";
import { createFakeClient } from "./fake-client";

describe("listMetricSources", () => {
  it("calls metric_sources with dates and maps rows", async () => {
    const seen: Record<string, unknown>[] = [];
    const { client } = createFakeClient({
      rpc: {
        metric_sources: (args) => {
          seen.push(args);
          return [
            {
              upload_id: "u1",
              file_name: "timmar.xlsx",
              dataset_key: "ip_timmar",
              template_name: "Intelliplan timmar",
              template_version: 3,
              published_at: "2026-10-05T08:00:00Z",
              months: ["2026-08-01", "2026-09-01"],
            },
          ];
        },
      },
    });
    const rows = await listMetricSources(client, ["timmar"], ["MBAB", "MBR"], "2026-08", "2026-09");
    expect(seen).toEqual([
      {
        p_metric_keys: ["timmar"],
        p_company_codes: ["MBAB", "MBR"],
        p_from: "2026-08-01",
        p_to: "2026-09-01",
      },
    ]);
    expect(rows).toEqual([
      {
        uploadId: "u1",
        fileName: "timmar.xlsx",
        datasetKey: "ip_timmar",
        templateName: "Intelliplan timmar",
        templateVersion: 3,
        publishedAt: "2026-10-05T08:00:00Z",
        months: ["2026-08", "2026-09"],
      },
    ]);
  });

  it("skips the call without metrics or companies and surfaces errors", async () => {
    const { client, calls } = createFakeClient({
      fail: () => ({ message: "Ingen behörighet" }),
    });
    expect(await listMetricSources(client, [], ["MBAB"], "2026-01", "2026-09")).toEqual([]);
    expect(await listMetricSources(client, ["timmar"], [], "2026-01", "2026-09")).toEqual([]);
    expect(calls).toHaveLength(0);
    await expect(
      listMetricSources(client, ["timmar"], ["MBAB"], "2026-01", "2026-09"),
    ).rejects.toThrow("Ingen behörighet");
  });
});
