import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CATALOG_ACCOUNT_GROUPS,
  CATALOG_DATASETS,
  CATALOG_DIMENSIONS,
  CATALOG_METRICS,
  type CatalogMetric,
} from "@/lib/contracts/catalog";
import { COMPANIES, SEEDED_VERKSAMHETER } from "@/lib/contracts/domain";
import { createTestDb, type Db } from "./harness";

describe("seed mirrors src/lib/contracts/catalog.ts", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("dimensions", async () => {
    const res = await db.query<{
      key: string;
      label: string;
      personal: boolean;
      unknownPolicy: string;
    }>(
      `select key, label, is_personal as personal, unknown_policy as "unknownPolicy"
       from public.dimensions order by id`,
    );
    expect(res.rows).toEqual(CATALOG_DIMENSIONS);
  });

  it("datasets with their dimensions", async () => {
    const res = await db.query<{ key: string; name: string; kind: string; dimensions: string[] }>(
      `select d.key, d.name, d.kind,
         coalesce(array_agg(dim.key order by dim.id) filter (where dim.key is not null), '{}') as dimensions
       from public.datasets d
       left join public.dataset_dimensions dd on dd.dataset_id = d.id
       left join public.dimensions dim on dim.id = dd.dimension_id
       group by d.id order by d.id`,
    );
    const byDimensionOrder = (keys: string[]) =>
      [...keys].sort(
        (a, b) =>
          CATALOG_DIMENSIONS.findIndex((d) => d.key === a) -
          CATALOG_DIMENSIONS.findIndex((d) => d.key === b),
      );
    expect(res.rows).toEqual(
      CATALOG_DATASETS.map((d) => ({ ...d, dimensions: byDimensionOrder(d.dimensions) })),
    );
  });

  it("account groups with ranges", async () => {
    const res = await db.query<{
      key: string;
      name: string;
      sign: number;
      ranges: { from: number; to: number }[];
    }>(
      `select g.key, g.name, g.sign,
         jsonb_agg(jsonb_build_object('from', r.from_account, 'to', r.to_account) order by r.id) as ranges
       from public.account_groups g
       join public.account_group_ranges r on r.group_key = g.key
       group by g.key, g.name, g.sign, g.sort order by g.sort`,
    );
    expect(res.rows).toEqual(CATALOG_ACCOUNT_GROUPS);
  });

  it("metrics, every field", async () => {
    const res = await db.query<Record<string, unknown>>(
      `select m.key, m.name, m.unit, m.kind, d.key as "datasetKey", m.higher_is_better as "higherIsBetter",
         m.decimals, m.description, m.headline_subject as "headlineSubject",
         m.snapshot_rollup as "snapshotRollup", b.key as "baseMetricKey",
         dim.key as "distinctDimension", m.account_group_key as "accountGroupKey", m.formula,
         m.is_system as "isSystem"
       from public.metrics m
       left join public.datasets d on d.id = m.dataset_id
       left join public.metrics b on b.id = m.base_metric_id
       left join public.dimensions dim on dim.id = m.distinct_dimension_id
       order by m.id`,
    );
    const optional: (keyof CatalogMetric)[] = [
      "snapshotRollup",
      "baseMetricKey",
      "distinctDimension",
      "accountGroupKey",
      "formula",
    ];
    const fromDb = res.rows.map((row) => {
      const out: Record<string, unknown> = { ...row };
      expect(out.isSystem, String(row.key)).toBe(true);
      delete out.isSystem;
      for (const key of optional) if (out[key] === null) delete out[key];
      return out;
    });
    expect(fromDb).toEqual(CATALOG_METRICS);
  });

  it("companies", async () => {
    const res = await db.query<{
      code: string;
      legalName: string;
      shortName: string;
      orgNr: string;
      fiscal: number;
    }>(
      `select code, legal_name as "legalName", short_name as "shortName", org_nr as "orgNr",
         fiscal_start_month as fiscal
       from public.companies order by id`,
    );
    expect(res.rows).toEqual(
      Object.entries(COMPANIES).map(([code, c]) => ({ code, ...c, fiscal: 1 })),
    );
  });

  it("verksamhet and kontogrupp values", async () => {
    const res = await db.query<{ dim: string; code: string; label: string }>(
      `select d.key as dim, dv.code, dv.label
       from public.dimension_values dv join public.dimensions d on d.id = dv.dimension_id
       order by d.key, dv.sort`,
    );
    expect(res.rows.filter((r) => r.dim === "verksamhet")).toEqual(
      SEEDED_VERKSAMHETER.map((label) => ({
        dim: "verksamhet",
        code: label.toLocaleLowerCase("sv"),
        label,
      })),
    );
    expect(res.rows.filter((r) => r.dim === "kontogrupp")).toEqual(
      CATALOG_ACCOUNT_GROUPS.map((g) => ({ dim: "kontogrupp", code: g.key, label: g.name })),
    );
    expect(res.rows.filter((r) => r.dim !== "verksamhet" && r.dim !== "kontogrupp")).toEqual([]);
  });

  it("verksamhet codes equal the SQL normalization of their labels", async () => {
    const res = await db.query<{ code: string; norm: string }>(
      `select dv.code, private.normalize_label(dv.label) as norm
       from public.dimension_values dv join public.dimensions d on d.id = dv.dimension_id
       where d.key = 'verksamhet'`,
    );
    for (const r of res.rows) expect(r.code).toBe(r.norm);
  });

  it("settings", async () => {
    const res = await db.query<{ key: string; value: unknown }>(
      `select key, value from public.settings order by key`,
    );
    expect(res.rows).toEqual([
      { key: "deviation_threshold_pct", value: 25 },
      { key: "min_engine_version", value: 1 },
    ]);
  });
});
