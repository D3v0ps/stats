import { describe, expect, it } from "vitest";
import { createFakeClient } from "./fake-client";
import { createMetric, findDuplicate, findPublishedFiles } from "./import-extra";
import { catalogTables } from "./test-fixtures";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function uploadsTable() {
  const tables = catalogTables();
  const timmar = tables.datasets!.find((d) => d.key === "ip_timmar")!.id;
  const sie = tables.datasets!.find((d) => d.key === "fx_bokforing")!.id;
  tables.uploads = [
    {
      id: "u1",
      dataset_id: timmar,
      file_sha256: SHA_A,
      template_id: "t1",
      template_version: 1,
      status: "published",
      published_at: "2026-10-02T08:00:00Z",
    },
    {
      id: "u2",
      dataset_id: timmar,
      file_sha256: SHA_A,
      template_id: "t1",
      template_version: 2,
      status: "retracted",
      published_at: "2026-10-03T08:00:00Z",
    },
    {
      id: "u3",
      dataset_id: sie,
      file_sha256: SHA_B,
      template_id: null,
      template_version: null,
      status: "published",
      published_at: "2026-10-04T08:00:00Z",
    },
    {
      id: "u4",
      dataset_id: timmar,
      file_sha256: "c".repeat(64),
      template_id: "t1",
      template_version: 1,
      status: "published",
      published_at: "2026-10-05T08:00:00Z",
    },
  ];
  return tables;
}

describe("findPublishedFiles", () => {
  it("returns published uploads of the given files only", async () => {
    const { client, calls } = createFakeClient({ tables: uploadsTable() });
    const found = await findPublishedFiles(client, [SHA_A, SHA_B, SHA_A]);
    expect(found).toEqual([
      {
        uploadId: "u3",
        datasetKey: "fx_bokforing",
        fileSha256: SHA_B,
        templateId: null,
        templateVersion: null,
        publishedAt: "2026-10-04T08:00:00Z",
      },
      {
        uploadId: "u1",
        datasetKey: "ip_timmar",
        fileSha256: SHA_A,
        templateId: "t1",
        templateVersion: 1,
        publishedAt: "2026-10-02T08:00:00Z",
      },
    ]);
    const uploadsCall = calls.find((c) => c.target === "uploads")!;
    expect(uploadsCall.filters).toContainEqual({
      op: "in",
      column: "file_sha256",
      value: [SHA_A, SHA_B],
    });
    expect(uploadsCall.filters).toContainEqual({ op: "eq", column: "status", value: "published" });
  });

  it("does not query without files", async () => {
    const { client, calls } = createFakeClient({ tables: uploadsTable() });
    expect(await findPublishedFiles(client, [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("findDuplicate", () => {
  const published = [
    {
      uploadId: "u1",
      datasetKey: "ip_timmar",
      fileSha256: SHA_A,
      templateId: "t1",
      templateVersion: 1,
      publishedAt: "x",
    },
    {
      uploadId: "u3",
      datasetKey: "fx_bokforing",
      fileSha256: SHA_B,
      templateId: null,
      templateVersion: null,
      publishedAt: "y",
    },
  ];

  it("matches the same file, dataset and template version", () => {
    expect(
      findDuplicate(published, {
        datasetKey: "ip_timmar",
        sha256: SHA_A,
        templateId: "t1",
        templateVersion: 1,
      })?.uploadId,
    ).toBe("u1");
    expect(
      findDuplicate(published, {
        datasetKey: "fx_bokforing",
        sha256: SHA_B,
        templateId: null,
        templateVersion: null,
      })?.uploadId,
    ).toBe("u3");
  });

  it("allows the same file with a new template version", () => {
    expect(
      findDuplicate(published, {
        datasetKey: "ip_timmar",
        sha256: SHA_A,
        templateId: "t1",
        templateVersion: 2,
      }),
    ).toBeNull();
    expect(
      findDuplicate(published, {
        datasetKey: "ip_timmar",
        sha256: SHA_A,
        templateId: "t2",
        templateVersion: 1,
      }),
    ).toBeNull();
  });
});

describe("createMetric", () => {
  it("inserts a sum metric for the dataset", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    const created = await createMetric(client, {
      key: "overtid",
      name: " Övertid ",
      unit: "h",
      kind: "sum",
      datasetKey: "ip_timmar",
      higherIsBetter: null,
      headlineSubject: "ÖVERTIDEN",
    });
    expect(created).toEqual({
      key: "overtid",
      name: "Övertid",
      unit: "h",
      kind: "sum",
      datasetKey: "ip_timmar",
      higherIsBetter: null,
      decimals: 0,
    });
    const row = tables.metrics!.find((m) => m.key === "overtid")!;
    expect(row).toMatchObject({
      dataset_id: tables.datasets!.find((d) => d.key === "ip_timmar")!.id,
      snapshot_rollup: null,
      headline_subject: "ÖVERTIDEN",
    });
  });

  it("gives snapshots the last-month rollup and refuses unknown datasets", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await createMetric(client, {
      key: "platser",
      name: "Platser",
      unit: "st",
      kind: "snapshot",
      datasetKey: "wb_deltagare",
      higherIsBetter: true,
      headlineSubject: "PLATSERNA",
    });
    expect(tables.metrics!.find((m) => m.key === "platser")).toMatchObject({
      snapshot_rollup: "last",
      kind: "snapshot",
    });
    await expect(
      createMetric(client, {
        key: "x_y",
        name: "X",
        unit: "st",
        kind: "sum",
        datasetKey: "finns_inte",
        higherIsBetter: null,
        headlineSubject: "X",
      }),
    ).rejects.toThrow("Okänd datakälla");
  });
});
