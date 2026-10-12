import { describe, expect, it } from "vitest";
import { createFakeClient, type Row } from "./fake-client";
import {
  addAliases,
  createDimensionValues,
  createFormulaMetric,
  listMonthsWithData,
  relabelDimensionValues,
  replaceAccountGroupRanges,
  setCompanyFiscalStart,
  templateUploadCounts,
  toMetricUpdate,
  updateAccountGroup,
  updateMetric,
  validateAccountRanges,
} from "./settings-extra";
import { catalogTables } from "./test-fixtures";

const metric = (tables: Record<string, Row[]>, key: string) =>
  tables.metrics?.find((m) => m.key === key);

describe("metric edits", () => {
  it("maps a patch to columns, trimming and uppercasing the headline subject", () => {
    expect(
      toMetricUpdate({
        name: "  Fakturerade   timmar ",
        description: "  ",
        higherIsBetter: null,
        decimals: 1,
        headlineSubject: "timmarna",
      }),
    ).toEqual({
      name: "Fakturerade timmar",
      description: null,
      higher_is_better: null,
      decimals: 1,
      headline_subject: "TIMMARNA",
    });
    expect(toMetricUpdate({})).toEqual({});
    expect(() => toMetricUpdate({ name: " " })).toThrow(/namn/);
    expect(() => toMetricUpdate({ decimals: 7 })).toThrow(/0–6/);
    expect(() => toMetricUpdate({ decimals: 1.5 })).toThrow(/0–6/);
    expect(() => toMetricUpdate({ formula: "  " })).toThrow(/tom/);
  });

  it("updates name, direction and formula of a formula metric by key", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await updateMetric(client, "faktor", {
      name: "Faktor (med påslag)",
      higherIsBetter: true,
      formula: "fakturerat_ip / (lonekostnad * 1.31)",
    });
    expect(metric(tables, "faktor")).toMatchObject({
      name: "Faktor (med påslag)",
      higher_is_better: true,
      formula: "fakturerat_ip / (lonekostnad * 1.31)",
    });
  });

  it("refuses a formula on a non-formula metric and unknown keys", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await expect(updateMetric(client, "timmar", { formula: "pass * 2" })).rejects.toThrow(
      /Bara formelmått/,
    );
    expect(metric(tables, "timmar")?.formula).toBeNull();
    await expect(updateMetric(client, "finns_inte", { name: "X" })).rejects.toThrow(/finns inte/);
  });

  it("does nothing for an empty patch", async () => {
    const { client, calls } = createFakeClient({ tables: catalogTables() });
    await updateMetric(client, "timmar", {});
    expect(calls).toEqual([]);
  });

  it("creates a formula metric without dataset", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await createFormulaMetric(client, {
      key: "intakt_per_anstalld",
      name: "Intäkt per anställd",
      unit: "kr",
      formula: "fakturerat_ip / anstallda_konsulter",
      higherIsBetter: true,
      decimals: 0,
      headlineSubject: "intäkten per anställd",
    });
    expect(metric(tables, "intakt_per_anstalld")).toMatchObject({
      kind: "formula",
      dataset_id: null,
      unit: "kr",
      is_system: false,
      headline_subject: "INTÄKTEN PER ANSTÄLLD",
      description: null,
    });
    await expect(
      createFormulaMetric(client, {
        key: "Bad Key",
        name: "X",
        unit: "kr",
        formula: "timmar",
        higherIsBetter: null,
        decimals: null,
      }),
    ).rejects.toThrow();
  });
});

describe("account groups", () => {
  it("renames and flips the sign", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await updateAccountGroup(client, "intakter", { name: " Rörelsens intäkter ", sign: 1 });
    expect(tables.account_groups?.find((g) => g.key === "intakter")).toMatchObject({
      name: "Rörelsens intäkter",
      sign: 1,
    });
    await expect(updateAccountGroup(client, "nope", { name: "X" })).rejects.toThrow(/finns inte/);
    await expect(updateAccountGroup(client, "intakter", { name: "" })).rejects.toThrow(/namn/);
  });

  it("replaces ranges by inserting before deleting", async () => {
    const { client, tables, calls } = createFakeClient({ tables: catalogTables() });
    await replaceAccountGroupRanges(client, "personal", [
      { from: 7000, to: 7399 },
      { from: 7500, to: 7699 },
    ]);
    const ranges = tables.account_group_ranges!.filter((r) => r.group_key === "personal");
    expect(ranges.map((r) => [r.from_account, r.to_account])).toEqual([
      [7000, 7399],
      [7500, 7699],
    ]);
    const writes = calls.filter((c) => c.target === "account_group_ranges" && c.kind !== "select");
    expect(writes.map((c) => c.kind)).toEqual(["insert", "delete"]);
    // Other groups keep their ranges.
    expect(tables.account_group_ranges!.some((r) => r.group_key === "intakter")).toBe(true);
  });

  it("keeps the old ranges when the insert fails", async () => {
    const { client, tables } = createFakeClient({
      tables: catalogTables(),
      fail: (c) =>
        c.target === "account_group_ranges" && c.kind === "insert" ? { message: "boom" } : null,
    });
    await expect(
      replaceAccountGroupRanges(client, "personal", [{ from: 7000, to: 7399 }]),
    ).rejects.toThrow("boom");
    expect(tables.account_group_ranges!.filter((r) => r.group_key === "personal")).toHaveLength(1);
  });

  it("validates ranges", async () => {
    expect(() => validateAccountRanges([])).toThrow(/minst ett/);
    expect(() => validateAccountRanges([{ from: 999, to: 1200 }])).toThrow(/fyra siffror/);
    expect(() => validateAccountRanges([{ from: 4000, to: 3000 }])).toThrow(/lägre/);
    expect(() => validateAccountRanges([{ from: 3000, to: 3999 }])).not.toThrow();
    const { client } = createFakeClient({ tables: catalogTables() });
    await expect(
      replaceAccountGroupRanges(client, "nope", [{ from: 3000, to: 3999 }]),
    ).rejects.toThrow(/finns inte/);
  });
});

describe("companies", () => {
  it("sets the fiscal start month", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await setCompanyFiscalStart(client, "MBR", 7);
    expect(tables.companies?.find((c) => c.code === "MBR")?.fiscal_start_month).toBe(7);
    expect(tables.companies?.find((c) => c.code === "MBAB")?.fiscal_start_month).toBe(1);
    await expect(setCompanyFiscalStart(client, "MBR", 13)).rejects.toThrow(/1–12/);
  });
});

describe("months with data", () => {
  it("groups current utfall slices per company and month, newest first", async () => {
    const tables = catalogTables();
    tables.upload_slices = [
      {
        upload_id: "u1",
        dataset_id: 1,
        company_id: 1,
        scenario: "utfall",
        month: "2026-08-01",
        is_current: true,
      },
      {
        upload_id: "u2",
        dataset_id: 3,
        company_id: 1,
        scenario: "utfall",
        month: "2026-08-01",
        is_current: true,
      },
      {
        upload_id: "u3",
        dataset_id: 1,
        company_id: 1,
        scenario: "utfall",
        month: "2026-09-01",
        is_current: true,
      },
      {
        upload_id: "u4",
        dataset_id: 1,
        company_id: 2,
        scenario: "utfall",
        month: "2026-09-01",
        is_current: false,
      },
      {
        upload_id: "u5",
        dataset_id: 9,
        company_id: 2,
        scenario: "budget",
        month: "2026-12-01",
        is_current: true,
      },
    ];
    const { client } = createFakeClient({ tables });
    expect(await listMonthsWithData(client)).toEqual([
      { company: "MBAB", month: "2026-09", datasets: ["ip_timmar"] },
      { company: "MBAB", month: "2026-08", datasets: ["ip_timmar", "ip_fakturering"] },
    ]);
    expect(await listMonthsWithData(client, { scenario: "budget" })).toEqual([
      { company: "MBR", month: "2026-12", datasets: ["budget"] },
    ]);
  });
});

describe("template usage", () => {
  it("counts uploads per template", async () => {
    const tables = catalogTables();
    tables.uploads = [
      { id: "a", template_id: "t1" },
      { id: "b", template_id: "t1" },
      { id: "c", template_id: null },
      { id: "d", template_id: "t2" },
    ];
    const { client } = createFakeClient({ tables });
    expect(await templateUploadCounts(client)).toEqual({ t1: 2, t2: 1 });
  });
});

describe("dictionary bulk edits", () => {
  it("upserts normalized aliases in one request per chunk", async () => {
    const { client, tables, calls } = createFakeClient({ tables: catalogTables() });
    const count = await addAliases(client, "verksamhet", [
      { alias: "  Rusta  och Matcha ", valueId: 5 },
      { alias: "KROM 2", valueId: 2 },
      { alias: "krom 2", valueId: 1 },
      { alias: " ", valueId: 1 },
    ]);
    expect(count).toBe(2);
    expect(tables.dimension_aliases).toEqual([
      { dimension_id: 1, alias_norm: "rusta och matcha", value_id: 5 },
      { dimension_id: 1, alias_norm: "krom 2", value_id: 1 },
    ]);
    expect(calls.filter((c) => c.kind === "upsert")).toHaveLength(1);
    await expect(addAliases(client, "nope", [])).rejects.toThrow(/Okänd dimension/);
  });

  it("creates values with explicit codes and relabels values", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    const ids = await createDimensionValues(client, "konsult", [
      { code: " 1001 ", label: "Anna  Andersson" },
      { code: "1002", label: "Bo Berg" },
    ]);
    expect(Object.keys(ids)).toEqual(["1001", "1002"]);
    const konsult = tables.dimension_values!.filter((v) => v.dimension_id === 6);
    expect(konsult.map((v) => [v.code, v.label])).toEqual([
      ["1001", "Anna Andersson"],
      ["1002", "Bo Berg"],
    ]);
    await expect(
      createDimensionValues(client, "kostnadsstalle", [{ code: "100", label: "X" }]),
    ).rejects.toThrow(/bokföringen/);

    const n = await relabelDimensionValues(client, [
      { id: konsult[0]!.id as number, label: " Anna A. " },
      { id: konsult[1]!.id as number, label: "" },
    ]);
    expect(n).toBe(1);
    expect(tables.dimension_values!.find((v) => v.id === konsult[0]!.id)?.label).toBe("Anna A.");
  });
});
