import { describe, expect, it } from "vitest";
import { CATALOG_ACCOUNT_GROUPS, CATALOG_DATASETS, CATALOG_METRICS } from "@/lib/contracts/catalog";
import type { Tables } from "../types";
import {
  addAlias,
  buildDimensionDictionary,
  ensureDimensionValues,
  formulaOperands,
  listAccountGroups,
  listCompanies,
  listDatasets,
  listDimensionValues,
  listMetricDefinitions,
  loadDimensionDictionary,
  mergeDimensionValues,
  toMetricDefinitions,
  type DatasetInfo,
} from "./catalog";
import { createFakeClient } from "./fake-client";
import { DbError } from "./shared";
import { catalogTables } from "./test-fixtures";

const dims = (...keys: string[]) => keys;

describe("formulaOperands", () => {
  const keys = new Set(["timmar", "sjuktimmar", "konsulter", "fakturerat_ip", "lonekostnad"]);
  it("finds metric keys in order of first appearance", () => {
    expect(formulaOperands("sjuktimmar / (timmar + sjuktimmar) * 100", keys)).toEqual([
      "sjuktimmar",
      "timmar",
    ]);
    expect(formulaOperands("fakturerat_ip / (lonekostnad * 1.0)", keys)).toEqual([
      "fakturerat_ip",
      "lonekostnad",
    ]);
  });
  it("ignores numbers, unknown identifiers and partial matches", () => {
    expect(formulaOperands("timmar_x + 1e5 + okand / konsulter", keys)).toEqual(["konsulter"]);
  });
});

describe("toMetricDefinitions", () => {
  const datasets: DatasetInfo[] = [
    { id: 1, key: "a", name: "A", kind: "table", dimensions: dims("kund", "konsult") },
    { id: 2, key: "b", name: "B", kind: "table", dimensions: dims("kund", "ort") },
  ];
  const metric = (
    over: Partial<Tables<"metrics">> & { id: number; key: string },
  ): Tables<"metrics"> => ({
    name: over.key,
    unit: "st",
    kind: "sum",
    dataset_id: 1,
    higher_is_better: null,
    decimals: 0,
    description: null,
    headline_subject: null,
    snapshot_rollup: null,
    base_metric_id: null,
    distinct_dimension_id: null,
    account_group_key: null,
    formula: null,
    is_system: false,
    ...over,
  });

  it("intersects operand dimensions for formulas, recursively", () => {
    const defs = toMetricDefinitions(
      [
        metric({ id: 1, key: "x" }),
        metric({ id: 2, key: "y", dataset_id: 2 }),
        metric({ id: 3, key: "f", kind: "formula", dataset_id: null, formula: "x / y" }),
        metric({ id: 4, key: "g", kind: "formula", dataset_id: null, formula: "f * x" }),
        metric({ id: 5, key: "c1", kind: "formula", dataset_id: null, formula: "c2 + x" }),
        metric({ id: 6, key: "c2", kind: "formula", dataset_id: null, formula: "c1" }),
        metric({ id: 7, key: "k", kind: "formula", dataset_id: null, formula: "100" }),
      ],
      datasets,
      [],
    );
    const byKey = Object.fromEntries(defs.map((d) => [d.key, d.dimensions]));
    expect(byKey).toEqual({
      x: ["kund", "konsult"],
      y: ["kund", "ort"],
      f: ["kund"],
      g: ["kund"],
      c1: [],
      c2: [],
      k: [],
    });
  });

  it("rejects units and kinds outside the contract", () => {
    expect(() =>
      toMetricDefinitions([metric({ id: 1, key: "x", unit: "parsec" })], datasets, []),
    ).toThrow();
  });
});

describe("catalog reads", () => {
  it("maps the seeded catalog to MetricDefinition[] matching catalog.ts", async () => {
    const { client } = createFakeClient({ tables: catalogTables() });
    const defs = await listMetricDefinitions(client);
    expect(defs).toHaveLength(CATALOG_METRICS.length);
    for (const m of CATALOG_METRICS) {
      const def = defs.find((d) => d.key === m.key)!;
      expect(def, m.key).toMatchObject({
        name: m.name,
        unit: m.unit,
        kind: m.kind,
        datasetKey: m.datasetKey,
        higherIsBetter: m.higherIsBetter,
        decimals: m.decimals,
        description: m.description,
        headlineSubject: m.headlineSubject,
        snapshotRollup: m.snapshotRollup ?? null,
        baseMetricKey: m.baseMetricKey ?? null,
        distinctDimension: m.distinctDimension ?? null,
        accountGroupKey: m.accountGroupKey ?? null,
        formula: m.formula ?? null,
      });
      if (m.datasetKey) {
        const ds = CATALOG_DATASETS.find((d) => d.key === m.datasetKey)!;
        expect(new Set(def.dimensions), m.key).toEqual(new Set(ds.dimensions));
      }
    }
    const formula = Object.fromEntries(
      defs.filter((d) => d.kind === "formula").map((d) => [d.key, d.dimensions]),
    );
    expect(formula).toEqual({
      faktor: ["kund", "uppdrag", "konsult"],
      sjukfranvaro: ["kund", "uppdrag", "konsult"],
      sjukpass_per_konsult: ["kund", "uppdrag", "konsult"],
      timmar_per_konsult: ["verksamhet", "kund", "uppdrag", "konsult"],
      intakt_per_konsult: ["kund", "uppdrag", "konsult"],
      resultatmarginal: ["kostnadsstalle"],
      resultatandel: ["verksamhet", "ort", "resultattyp"],
    });
  });

  it("maps account groups and datasets", async () => {
    const { client } = createFakeClient({ tables: catalogTables() });
    expect(await listAccountGroups(client)).toEqual(CATALOG_ACCOUNT_GROUPS);
    const datasets = await listDatasets(client);
    expect(datasets.map((d) => d.key)).toEqual(CATALOG_DATASETS.map((d) => d.key));
    expect(datasets.find((d) => d.key === "ip_timmar")?.dimensions).toEqual([
      "verksamhet",
      "kund",
      "uppdrag",
      "konsult",
    ]);
  });

  it("maps companies", async () => {
    const { client } = createFakeClient({ tables: catalogTables() });
    expect(await listCompanies(client)).toEqual([
      {
        id: 1,
        code: "MBAB",
        legalName: "Miljonbemanning AB",
        shortName: "MB AB",
        orgNr: "556959-9318",
        fiscalStartMonth: 1,
      },
      {
        id: 2,
        code: "MBR",
        legalName: "Miljonbemanning Restart AB",
        shortName: "MB Restart",
        orgNr: "559208-9071",
        fiscalStartMonth: 1,
      },
    ]);
  });

  it("pages through dimension values beyond max_rows", async () => {
    const tables = catalogTables();
    const konsult = (tables.dimensions ?? []).find((d) => d.key === "konsult")!.id;
    for (let i = 0; i < 2500; i++) {
      tables.dimension_values!.push({
        id: 1000 + i,
        dimension_id: konsult,
        code: `k${i}`,
        label: `K${i}`,
        sort: 0,
        active: true,
      });
    }
    const { client, calls } = createFakeClient({ tables });
    const values = await listDimensionValues(client, { dimensionKey: "konsult" });
    expect(values).toHaveLength(2500);
    expect(calls.filter((c) => c.target === "dimension_values").map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});

describe("dimension dictionary", () => {
  const dimensions = [
    {
      id: 1,
      key: "verksamhet",
      label: "Verksamhet",
      personal: false,
      unknownPolicy: "ask" as const,
    },
    {
      id: 2,
      key: "kostnadsstalle",
      label: "Kostnadsställe",
      personal: false,
      unknownPolicy: "auto_create" as const,
    },
  ];

  it("keys codes, labels and aliases by normalized form with alias > code > label precedence", () => {
    const dict = buildDimensionDictionary(
      dimensions,
      [
        { id: 1, dimensionKey: "verksamhet", code: "krom", label: "KROM", sort: 1, active: true },
        {
          id: 2,
          dimensionKey: "verksamhet",
          code: "stöd och matchning",
          label: "Stöd och matchning",
          sort: 2,
          active: true,
        },
        {
          id: 3,
          dimensionKey: "verksamhet",
          code: "gammal",
          label: "Gammal",
          sort: 3,
          active: false,
        },
        { id: 4, dimensionKey: "verksamhet", code: "x", label: "krom", sort: 4, active: true },
        {
          id: 5,
          dimensionKey: "kostnadsstalle",
          code: "MBAB:100",
          label: "100 Stockholm",
          sort: 0,
          active: true,
        },
      ],
      [
        { dimensionKey: "verksamhet", aliasNorm: "kundval rusta och matcha", valueId: 1 },
        { dimensionKey: "verksamhet", aliasNorm: "gammal", valueId: 2 },
      ],
    );
    expect(dict.verksamhet).toEqual({
      policy: "ask",
      personal: false,
      byNorm: {
        krom: 1,
        "stöd och matchning": 2,
        x: 4,
        "kundval rusta och matcha": 1,
        gammal: 2,
      },
      labels: { 1: "KROM", 2: "Stöd och matchning", 3: "Gammal", 4: "krom" },
    });
    expect(dict.kostnadsstalle?.byNorm).toEqual({ "mbab:100": 5, "100 stockholm": 5 });
  });

  it("loads the dictionary for selected dimensions", async () => {
    const { client } = createFakeClient({ tables: catalogTables() });
    const dict = await loadDimensionDictionary(client, ["verksamhet"]);
    expect(Object.keys(dict)).toEqual(["verksamhet"]);
    expect(dict.verksamhet?.byNorm["stöd och matchning"]).toBeGreaterThan(0);
    expect(dict.verksamhet?.policy).toBe("ask");
  });
});

describe("dimension value management", () => {
  it("resolves labels in chunks through ensure_dimension_values", async () => {
    const seen: unknown[] = [];
    const { client } = createFakeClient({
      rpc: {
        ensure_dimension_values: (args) => {
          seen.push(args);
          return (args.p_labels as string[]).map((label, i) => ({
            label,
            id: label === "okänd" ? null : i + 1,
          }));
        },
      },
    });
    const labels = [...Array.from({ length: 600 }, (_, i) => `ort ${i}`), "okänd", "ort 1"];
    const res = await ensureDimensionValues(client, "ort", labels, { force: true });
    expect(Object.keys(res)).toHaveLength(601);
    expect(res["okänd"]).toBeNull();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ p_dimension: "ort", p_force: true });
  });

  it("stores aliases normalized", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await addAlias(client, "verksamhet", "  Kundval  RUSTA ", 2);
    expect(tables.dimension_aliases).toEqual([
      { dimension_id: 1, alias_norm: "kundval rusta", value_id: 2 },
    ]);
    await expect(addAlias(client, "finns_inte", "x", 1)).rejects.toThrow(/Unknown dimension/);
  });

  it("maps merge results and surfaces database errors", async () => {
    const { client } = createFakeClient({
      rpc: { merge_dimension_values: () => ({ from: 1, into: 2, facts: 5, ledger_rows: 1 }) },
    });
    expect(await mergeDimensionValues(client, 1, 2)).toEqual({
      from: 1,
      into: 2,
      facts: 5,
      ledgerRows: 1,
    });

    const failing = createFakeClient({
      fail: () => ({ message: "Värdena hör till olika dimensioner", code: "22023" }),
    });
    const error = await mergeDimensionValues(failing.client, 1, 2).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({
      message: "Värdena hör till olika dimensioner",
      code: "22023",
      operation: "merge_dimension_values",
    });
  });
});
