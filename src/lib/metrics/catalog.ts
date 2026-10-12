// MetricDefinition[] / AccountGroup[] built from the seeded catalog, with the same
// dimension rules as the database adapter: a metric gets its dataset's dimensions and
// a formula metric the intersection of its operands' dimensions.
import {
  CATALOG_ACCOUNT_GROUPS,
  CATALOG_DATASETS,
  CATALOG_METRICS,
  type CatalogDataset,
  type CatalogMetric,
} from "@/lib/contracts/catalog";
import type { AccountGroup, MetricDefinition } from "@/lib/contracts/metric-query";
import { parseFormula, referencedKeys } from "./formula";

export function catalogDefinitions(
  metrics: readonly CatalogMetric[] = CATALOG_METRICS,
  datasets: readonly CatalogDataset[] = CATALOG_DATASETS,
): MetricDefinition[] {
  const datasetDims = new Map(datasets.map((d) => [d.key, d.dimensions]));
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const memo = new Map<string, string[]>();

  const dimensionsOf = (key: string, visiting: Set<string>): string[] => {
    const cached = memo.get(key);
    if (cached) return cached;
    const metric = byKey.get(key);
    if (!metric) return [];
    let dims: string[];
    if (metric.kind === "formula") {
      if (visiting.has(key)) return [];
      visiting.add(key);
      const operands = referencedKeys(parseFormula(metric.formula ?? "0")).filter((k) =>
        byKey.has(k),
      );
      const operandDims = operands.map((k) => dimensionsOf(k, visiting));
      visiting.delete(key);
      dims =
        operandDims.length === 0
          ? []
          : operandDims.reduce((acc, d) => acc.filter((k) => d.includes(k)));
    } else {
      dims = [...((metric.datasetKey && datasetDims.get(metric.datasetKey)) || [])];
    }
    memo.set(key, dims);
    return dims;
  };

  return metrics.map((m) => ({
    key: m.key,
    name: m.name,
    unit: m.unit,
    kind: m.kind,
    datasetKey: m.datasetKey,
    higherIsBetter: m.higherIsBetter,
    decimals: m.decimals,
    description: m.description,
    snapshotRollup: m.snapshotRollup ?? null,
    baseMetricKey: m.baseMetricKey ?? null,
    distinctDimension: m.distinctDimension ?? null,
    accountGroupKey: m.accountGroupKey ?? null,
    formula: m.formula ?? null,
    headlineSubject: m.headlineSubject,
    dimensions: dimensionsOf(m.key, new Set()),
  }));
}

export function catalogAccountGroups(): AccountGroup[] {
  return CATALOG_ACCOUNT_GROUPS.map((g) => ({
    key: g.key,
    name: g.name,
    sign: g.sign,
    ranges: g.ranges.map((r) => ({ ...r })),
  }));
}
