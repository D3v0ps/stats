// Seed-shaped rows built from catalog.ts (ids in catalog order, like 0009_seed.sql),
// for unit tests of the repo adapters with the fake client.
import {
  CATALOG_ACCOUNT_GROUPS,
  CATALOG_DATASETS,
  CATALOG_DIMENSIONS,
  CATALOG_METRICS,
} from "@/lib/contracts/catalog";
import { COMPANIES, SEEDED_VERKSAMHETER } from "@/lib/contracts/domain";
import type { Row } from "./fake-client";

export function catalogTables(): Record<string, Row[]> {
  const dimensions = CATALOG_DIMENSIONS.map((d, i) => ({
    id: i + 1,
    key: d.key,
    label: d.label,
    is_personal: d.personal,
    unknown_policy: d.unknownPolicy,
  }));
  const datasets = CATALOG_DATASETS.map((d, i) => ({
    id: i + 1,
    key: d.key,
    name: d.name,
    kind: d.kind,
  }));
  const dimId = (key: string) => dimensions.find((d) => d.key === key)!.id;
  const datasetId = (key: string) => datasets.find((d) => d.key === key)!.id;
  const datasetDimensions = CATALOG_DATASETS.flatMap((d) =>
    d.dimensions.map((k) => ({ dataset_id: datasetId(d.key), dimension_id: dimId(k) })),
  );
  const metrics = CATALOG_METRICS.map((m, i) => ({
    id: i + 1,
    key: m.key,
    name: m.name,
    unit: m.unit,
    kind: m.kind,
    dataset_id: m.datasetKey ? datasetId(m.datasetKey) : null,
    higher_is_better: m.higherIsBetter,
    decimals: m.decimals,
    description: m.description,
    headline_subject: m.headlineSubject,
    snapshot_rollup: m.snapshotRollup ?? null,
    base_metric_id: m.baseMetricKey
      ? CATALOG_METRICS.findIndex((x) => x.key === m.baseMetricKey) + 1
      : null,
    distinct_dimension_id: m.distinctDimension ? dimId(m.distinctDimension) : null,
    account_group_key: m.accountGroupKey ?? null,
    formula: m.formula ?? null,
    is_system: true,
  }));
  let rangeId = 0;
  const ranges = CATALOG_ACCOUNT_GROUPS.flatMap((g) =>
    g.ranges.map((r) => ({
      id: ++rangeId,
      group_key: g.key,
      from_account: r.from,
      to_account: r.to,
    })),
  );
  let valueId = 0;
  const values = [
    ...SEEDED_VERKSAMHETER.map((label, i) => ({
      id: ++valueId,
      dimension_id: dimId("verksamhet"),
      code: label.toLocaleLowerCase("sv"),
      label,
      sort: i + 1,
      active: true,
    })),
    ...CATALOG_ACCOUNT_GROUPS.map((g, i) => ({
      id: ++valueId,
      dimension_id: dimId("kontogrupp"),
      code: g.key,
      label: g.name,
      sort: i + 1,
      active: true,
    })),
  ];
  return {
    companies: Object.entries(COMPANIES).map(([code, c], i) => ({
      id: i + 1,
      code,
      legal_name: c.legalName,
      short_name: c.shortName,
      org_nr: c.orgNr,
      fiscal_start_month: 1,
    })),
    dimensions,
    datasets,
    dataset_dimensions: datasetDimensions,
    metrics,
    account_groups: CATALOG_ACCOUNT_GROUPS.map((g, i) => ({
      key: g.key,
      name: g.name,
      sign: g.sign,
      sort: i + 1,
    })),
    account_group_ranges: ranges,
    dimension_values: values,
    dimension_aliases: [],
    settings: [
      { key: "deviation_threshold_pct", value: 25 },
      { key: "min_engine_version", value: 1 },
    ],
  };
}
