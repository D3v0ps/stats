import { describe, expect, it } from "vitest";
import type { FactRow, LedgerRow, UploadCreate } from "@/lib/contracts/import-payload";
import { createFakeClient, type FakeOptions } from "./fake-client";
import { catalogTables } from "./test-fixtures";
import {
  createUpload,
  discardStaleUploads,
  discardUpload,
  getUpload,
  kostnadsstalleCode,
  listUploads,
  publishUpload,
  retractUpload,
  reviewCompare,
  sanitizeParseReport,
  stageFacts,
  stageLedger,
  stageUpload,
  toLedgerInserts,
  toReviewComparison,
  uniqueSlices,
} from "./uploads";

const hex = (c: string) => c.repeat(64);

const upload = (over: Partial<UploadCreate> = {}): UploadCreate => ({
  datasetKey: "ip_timmar",
  templateId: null,
  templateVersion: null,
  scenario: "utfall",
  fileName: "timmar.xlsx",
  fileSha256: hex("a"),
  fileSize: 1234,
  contentHash: hex("b"),
  engineVersion: 1,
  asOfDate: null,
  slices: [
    { company: "MBAB", month: "2026-08", priority: 0 },
    { company: "MBAB", month: "2026-09", priority: 0 },
  ],
  parseReport: { rowsRead: 10 },
  totals: [],
  ...over,
});

function fake(options: FakeOptions = {}) {
  return createFakeClient({ tables: catalogTables(), ...options });
}

const fact = (i: number, over: Partial<FactRow> = {}): FactRow => ({
  metricKey: "timmar",
  company: "MBAB",
  month: "2026-09",
  dims: { kund: 1, konsult: 1000 + i },
  value: i,
  sourceRows: [i + 2],
  ...over,
});

describe("createUpload", () => {
  it("inserts the upload and its slices with ids and first-of-month dates", async () => {
    const { client, tables } = fake();
    const id = await createUpload(client, upload());
    expect(tables.uploads).toEqual([
      expect.objectContaining({
        id,
        dataset_id: 1,
        scenario: "utfall",
        file_name: "timmar.xlsx",
        file_sha256: hex("a"),
        engine_version: 1,
        parse_report: { rowsRead: 10 },
        totals: [],
      }),
    ]);
    expect(tables.upload_slices).toEqual([
      expect.objectContaining({
        upload_id: id,
        dataset_id: 1,
        company_id: 1,
        scenario: "utfall",
        month: "2026-08-01",
        priority: 0,
      }),
      expect.objectContaining({
        upload_id: id,
        dataset_id: 1,
        company_id: 1,
        scenario: "utfall",
        month: "2026-09-01",
        priority: 0,
      }),
    ]);
  });

  it("stores parse reports without raw cell values", async () => {
    const report = {
      rowsRead: 3,
      issues: [
        {
          sourceRow: 4,
          column: "timmar",
          value: "Anna 8,5",
          message: "Inte ett tal",
          severity: "error",
        },
      ],
      skipped: [
        { sourceRow: 9, reason: "sum_row", detail: "Summa Anna Andersson" },
        { sourceRow: 12, reason: "empty" },
      ],
      warnings: ["Okända värden för kund: Acme AB."],
    };
    expect(sanitizeParseReport(report)).toEqual({
      rowsRead: 3,
      issues: [{ sourceRow: 4, column: "timmar", message: "Inte ett tal", severity: "error" }],
      skipped: [
        { sourceRow: 9, reason: "sum_row" },
        { sourceRow: 12, reason: "empty" },
      ],
      warnings: ["Okända värden för kund: Acme AB."],
    });
    expect(report.issues[0]?.value).toBe("Anna 8,5");
    expect(report.skipped[0]?.detail).toBe("Summa Anna Andersson");
    expect(sanitizeParseReport(null)).toEqual({});
    expect(sanitizeParseReport([1, 2])).toEqual({});
    const { client, tables } = fake();
    await createUpload(client, upload({ parseReport: report }));
    expect(tables.uploads?.[0]?.parse_report).toEqual(sanitizeParseReport(report));
  });

  it("inserts one slice per company and month, keeping the highest priority", async () => {
    const { client, tables } = fake();
    await createUpload(
      client,
      upload({
        slices: [
          { company: "MBAB", month: "2026-09", priority: -1 },
          { company: "MBAB", month: "2026-09", priority: 0 },
          { company: "MBR", month: "2026-09", priority: 0 },
          { company: "MBAB", month: "2026-09", priority: -1 },
        ],
      }),
    );
    expect(tables.upload_slices?.map((s) => [s.company_id, s.month, s.priority])).toEqual([
      [1, "2026-09-01", 0],
      [2, "2026-09-01", 0],
    ]);
    expect(
      uniqueSlices([
        { company: "MBR" as const, month: "2026-01", priority: 0 },
        { company: "MBR" as const, month: "2026-01", priority: -1 },
      ]),
    ).toEqual([{ company: "MBR", month: "2026-01", priority: 0 }]);
  });

  it("validates input with the contract schema", async () => {
    const { client, calls } = fake();
    await expect(createUpload(client, upload({ fileSha256: "nope" }))).rejects.toThrow();
    await expect(createUpload(client, upload({ slices: [] }))).rejects.toThrow();
    await expect(createUpload(client, upload({ datasetKey: "okand_kalla" }))).rejects.toThrow(
      /Okänd datakälla/,
    );
    expect(calls.filter((c) => c.kind === "insert")).toEqual([]);
  });

  it("discards the upload when slices cannot be inserted", async () => {
    const { client, calls } = fake({
      fail: (c) =>
        c.kind === "insert" && c.target === "upload_slices"
          ? { message: "row-level security" }
          : null,
      rpc: { discard_upload: () => ({ facts: 0, ledger_rows: 0 }) },
    });
    await expect(createUpload(client, upload())).rejects.toThrow(/row-level security/);
    expect(calls.some((c) => c.kind === "rpc" && c.target === "discard_upload")).toBe(true);
  });
});

describe("stageFacts", () => {
  it("inserts in chunks of 2000 with metric and company ids", async () => {
    const { client, calls, tables } = fake();
    const facts = Array.from({ length: 4500 }, (_, i) => fact(i));
    const progress: number[] = [];
    expect(
      await stageFacts(client, "u1", facts, { onProgress: (p) => progress.push(p.done) }),
    ).toBe(4500);
    const inserts = calls.filter((c) => c.kind === "insert" && c.target === "metric_values");
    expect(inserts.map((c) => (c.payload as unknown[]).length)).toEqual([2000, 2000, 500]);
    expect(progress).toEqual([2000, 4000, 4500]);
    expect(tables.metric_values?.[0]).toMatchObject({
      upload_id: "u1",
      metric_id: 1,
      company_id: 1,
      month: "2026-09-01",
      dims: { kund: 1, konsult: 1000 },
      value: 0,
      source_rows: [2],
    });
  });

  it("stores empty source rows as null and rejects unknown metrics or companies", async () => {
    const { client, tables } = fake();
    await stageFacts(client, "u1", [
      fact(1, { sourceRows: [], company: "MBR", metricKey: "pass" }),
    ]);
    expect(tables.metric_values?.[0]).toMatchObject({
      source_rows: null,
      company_id: 2,
      metric_id: 2,
    });
    await expect(stageFacts(client, "u1", [fact(1, { metricKey: "okant" })])).rejects.toThrow(
      "Okänt mått: okant",
    );
    await expect(
      stageFacts(client, "u1", [fact(1, { company: "XYZ" as unknown as "MBAB" })]),
    ).rejects.toThrow("Okänt bolag: XYZ");
  });

  it("stops at the first failing chunk", async () => {
    const { client, calls } = fake({
      fail: (c) => (c.target === "metric_values" ? { message: "nope" } : null),
    });
    await expect(
      stageFacts(
        client,
        "u1",
        Array.from({ length: 2500 }, (_, i) => fact(i)),
      ),
    ).rejects.toThrow(/nope/);
    expect(calls.filter((c) => c.target === "metric_values")).toHaveLength(1);
  });
});

describe("stageLedger", () => {
  const row = (over: Partial<LedgerRow>): LedgerRow => ({
    company: "MBAB",
    month: "2026-01",
    account: 3010,
    dimNo: null,
    objectCode: null,
    amount: -100,
    yearOffset: 0,
    source: "psaldo",
    ...over,
  });

  it("maps rows and skips object rows of other dimensions", () => {
    const { inserts, skippedObjectRows } = toLedgerInserts(
      "u1",
      [
        row({}),
        row({ dimNo: 1, objectCode: "100" }),
        row({ dimNo: 6, objectCode: "P1" }),
        row({ yearOffset: -1, month: "2025-12" }),
      ],
      () => 1,
      (company, code) => (company === "MBAB" && code === "100" ? 77 : -1),
    );
    expect(skippedObjectRows).toBe(1);
    expect(inserts).toEqual([
      {
        upload_id: "u1",
        company_id: 1,
        month: "2026-01-01",
        account: 3010,
        dim_no: null,
        object_value_id: null,
        amount: -100,
        year_offset: 0,
        source: "psaldo",
      },
      {
        upload_id: "u1",
        company_id: 1,
        month: "2026-01-01",
        account: 3010,
        dim_no: 1,
        object_value_id: 77,
        amount: -100,
        year_offset: 0,
        source: "psaldo",
      },
      {
        upload_id: "u1",
        company_id: 1,
        month: "2025-12-01",
        account: 3010,
        dim_no: null,
        object_value_id: null,
        amount: -100,
        year_offset: -1,
        source: "psaldo",
      },
    ]);
    expect(() =>
      toLedgerInserts(
        "u1",
        [row({ dimNo: 1, objectCode: null })],
        () => 1,
        () => 1,
      ),
    ).toThrow(/utan objektkod/);
  });

  it("creates scoped kostnadsställe values, names new ones and stages rows", async () => {
    const ensured: unknown[] = [];
    const { client, tables, calls } = fake({
      rpc: {
        ensure_dimension_values: (args) => {
          ensured.push(args);
          return [
            { label: "MBAB:100", id: 500 },
            { label: "MBAB:200", id: 501 },
          ];
        },
      },
    });
    tables.dimension_values!.push(
      { id: 500, dimension_id: 4, code: "MBAB:100", label: "MBAB:100", sort: 0, active: true },
      { id: 501, dimension_id: 4, code: "MBAB:200", label: "Egen etikett", sort: 0, active: true },
    );
    const result = await stageLedger(client, "u1", {
      rows: [
        row({}),
        row({ dimNo: 1, objectCode: "100" }),
        row({ dimNo: 1, objectCode: "200" }),
        row({ dimNo: 6, objectCode: "P" }),
      ],
      accounts: [{ company: "MBAB", account: 3010, name: " Försäljning " }],
      objects: [
        { company: "MBAB", dimNo: 1, code: "100", name: "Stockholm" },
        { company: "MBAB", dimNo: 1, code: "200", name: "Göteborg" },
        { company: "MBAB", dimNo: 6, code: "P", name: "Projekt" },
      ],
    });
    expect(result).toEqual({ rows: 3, skippedObjectRows: 1, accounts: 1, objects: 2 });
    expect(ensured).toEqual([
      { p_dimension: "kostnadsstalle", p_labels: ["MBAB:100", "MBAB:200"], p_force: false },
    ]);
    const labels = Object.fromEntries(
      tables.dimension_values!.filter((v) => (v.id as number) >= 500).map((v) => [v.id, v.label]),
    );
    expect(labels).toEqual({ 500: "100 Stockholm", 501: "Egen etikett" });
    expect(tables.ledger_accounts).toEqual([{ company_id: 1, account: 3010, name: "Försäljning" }]);
    expect(calls.find((c) => c.target === "ledger_accounts")?.options).toEqual({
      onConflict: "company_id,account",
    });
    expect(tables.ledger_balances?.map((r) => r.object_value_id)).toEqual([null, 500, 501]);
  });

  it("builds scoped codes", () => {
    expect(kostnadsstalleCode("MBR", " 100 ")).toBe("MBR:100");
    expect(kostnadsstalleCode("MBAB", "Syd \u00a0 2")).toBe("MBAB:Syd 2");
  });

  it("names new values by their scoped label, also when the code has letters", async () => {
    // ensure_dimension_values lowercases the code ("MBAB:a1") but creates the label as sent.
    const { client, tables } = fake({
      rpc: {
        ensure_dimension_values: () => [
          { label: "MBAB:A1", id: 600 },
          { label: "MBAB:Syd 2", id: 601 },
          { label: "MBAB:300", id: 602 },
        ],
      },
    });
    tables.dimension_values!.push(
      { id: 600, dimension_id: 4, code: "MBAB:a1", label: "MBAB:A1", sort: 0, active: true },
      { id: 601, dimension_id: 4, code: "MBAB:syd 2", label: "MBAB:Syd 2", sort: 0, active: true },
      // Matched through an alias: a value with another label is never renamed.
      { id: 602, dimension_id: 4, code: "MBAB:3000", label: "MBAB:3000", sort: 0, active: true },
    );
    await stageLedger(client, "u1", {
      rows: [row({ dimNo: 1, objectCode: "A1" }), row({ dimNo: 1, objectCode: "Syd  2" })],
      accounts: [
        { company: "MBAB", account: 3010, name: "Försäljning" },
        { company: "MBAB", account: 3010, name: "Försäljning tjänster" },
        { company: "MBR", account: 3010, name: "Försäljning" },
      ],
      objects: [
        { company: "MBAB", dimNo: 1, code: "A1", name: " Administration " },
        { company: "MBAB", dimNo: 1, code: "Syd 2", name: "Region  syd" },
        { company: "MBAB", dimNo: 1, code: "300", name: "Lager" },
      ],
    });
    const labels = Object.fromEntries(
      tables.dimension_values!.filter((v) => (v.id as number) >= 600).map((v) => [v.id, v.label]),
    );
    expect(labels).toEqual({ 600: "A1 Administration", 601: "Syd 2 Region syd", 602: "MBAB:3000" });
    expect(tables.ledger_balances?.map((r) => r.object_value_id)).toEqual([600, 601]);
    // A repeated account in one upsert would fail in Postgres; the last name wins.
    expect(tables.ledger_accounts).toEqual([
      { company_id: 1, account: 3010, name: "Försäljning tjänster" },
      { company_id: 2, account: 3010, name: "Försäljning" },
    ]);
  });
});

describe("stageUpload", () => {
  it("discards the upload when staging fails", async () => {
    const { client, calls } = fake({
      fail: (c) => (c.target === "metric_values" ? { message: "fel" } : null),
      rpc: { discard_upload: () => ({ facts: 0, ledger_rows: 0 }) },
    });
    await expect(stageUpload(client, { upload: upload(), facts: [fact(1)] })).rejects.toThrow(
      /fel/,
    );
    expect(calls.filter((c) => c.kind === "rpc").map((c) => c.target)).toEqual(["discard_upload"]);
  });
});

describe("lifecycle RPCs", () => {
  it("maps publish, retract and discard results", async () => {
    const { client } = fake({
      rpc: {
        publish_upload: () => ({
          upload_id: "u1",
          dataset: "ip_timmar",
          slices: 2,
          current: 1,
          kept: 1,
          superseded: ["u0"],
          facts: 10,
          ledger_rows: 0,
        }),
        retract_upload: () => ({
          upload_id: "u1",
          released: 2,
          restored: 1,
          restored_from: ["u0"],
        }),
        discard_upload: () => ({ upload_id: "u2", facts: 5, ledger_rows: 3 }),
      },
    });
    expect(await publishUpload(client, "u1")).toEqual({
      uploadId: "u1",
      dataset: "ip_timmar",
      slices: 2,
      current: 1,
      kept: 1,
      superseded: ["u0"],
      facts: 10,
      ledgerRows: 0,
    });
    expect(await retractUpload(client, "u1", "fel fil")).toEqual({
      released: 2,
      restored: 1,
      restoredFrom: ["u0"],
    });
    expect(await discardUpload(client, "u2")).toEqual({ facts: 5, ledgerRows: 3 });
  });

  it("discards stale staged uploads with a whole number of hours, 24 by default", async () => {
    const { client, calls } = createFakeClient({ rpc: { discard_stale_uploads: () => 2 } });
    expect(await discardStaleUploads(client)).toBe(2);
    expect(await discardStaleUploads(client, 48)).toBe(2);
    expect(calls.map((c) => c.payload)).toEqual([
      { p_older_than_hours: 24 },
      { p_older_than_hours: 48 },
    ]);
    for (const bad of [0, -3, 1.5, Number.NaN]) {
      await expect(discardStaleUploads(client, bad)).rejects.toThrow(/minst en/);
    }
    expect(calls).toHaveLength(2);
  });

  it("maps review rows", async () => {
    const json = {
      upload_id: "u1",
      dataset: "ip_timmar",
      scenario: "utfall",
      threshold_pct: 25,
      rows: [
        {
          metric_key: "timmar",
          company: "MBAB",
          month: "2026-09",
          staged: 150,
          current: null,
          previous: 110,
          change_pct: null,
          deviation_pct: 36.4,
          flagged: true,
          replaces_current: true,
        },
        {
          metric_key: "intakter",
          company: "MBAB",
          month: "2025-12",
          staged: "1100",
          current: 1000,
          previous: null,
          change_pct: 10,
          deviation_pct: null,
          flagged: false,
          replaces_current: false,
        },
      ],
    };
    const { client } = fake({ rpc: { review_compare: () => json } });
    expect(await reviewCompare(client, "u1")).toEqual({
      uploadId: "u1",
      dataset: "ip_timmar",
      scenario: "utfall",
      thresholdPct: 25,
      rows: [
        {
          metricKey: "timmar",
          company: "MBAB",
          month: "2026-09",
          staged: 150,
          current: null,
          previous: 110,
          changePct: null,
          deviationPct: 36.4,
          flagged: true,
          replacesCurrent: true,
        },
        {
          metricKey: "intakter",
          company: "MBAB",
          month: "2025-12",
          staged: 1100,
          current: 1000,
          previous: null,
          changePct: 10,
          deviationPct: null,
          flagged: false,
          replacesCurrent: false,
        },
      ],
    });
    expect(() => toReviewComparison({ rows: "x" })).toThrow(/Oväntat svar/);
  });
});

describe("history", () => {
  it("lists uploads with companies and months, newest first", async () => {
    const tables = catalogTables();
    tables.uploads = [
      {
        id: "u1",
        dataset_id: 1,
        scenario: "utfall",
        status: "published",
        file_name: "a.xlsx",
        template_id: null,
        template_version: null,
        created_at: "2026-10-01T10:00:00Z",
        published_at: "2026-10-01T10:01:00Z",
        retracted_at: null,
        retract_reason: null,
      },
      {
        id: "u2",
        dataset_id: 7,
        scenario: "utfall",
        status: "staged",
        file_name: "b.se",
        template_id: null,
        template_version: null,
        created_at: "2026-10-02T10:00:00Z",
        published_at: null,
        retracted_at: null,
        retract_reason: null,
      },
    ];
    tables.upload_slices = [
      { upload_id: "u1", company_id: 1, month: "2026-09-01", is_current: true },
      { upload_id: "u1", company_id: 2, month: "2026-08-01", is_current: false },
      { upload_id: "u1", company_id: 1, month: "2026-08-01", is_current: false },
    ];
    const { client } = createFakeClient({ tables });
    const items = await listUploads(client);
    expect(items.map((i) => i.id)).toEqual(["u2", "u1"]);
    expect(items[1]).toMatchObject({
      datasetKey: "ip_timmar",
      status: "published",
      companies: ["MBAB", "MBR"],
      months: ["2026-08", "2026-09"],
      currentMonths: ["2026-09"],
    });
    expect((await listUploads(client, { datasetKey: "fx_bokforing" })).map((i) => i.id)).toEqual([
      "u2",
    ]);
    expect((await listUploads(client, { status: ["published"] })).map((i) => i.id)).toEqual(["u1"]);
    expect(await getUpload(client, "u1")).toMatchObject({ id: "u1", fileName: "a.xlsx" });
    expect(await getUpload(client, "missing")).toBeNull();
  });
});
