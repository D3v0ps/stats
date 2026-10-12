// Metric metadata for the workspace UI: area grouping for the metric picker, which data
// stands behind a formula, which dimensions a set of metrics supports and why a breakdown
// does not apply ("Kund finns inte i bokföringen").
import { SEEDED_DATASETS, SEEDED_DIMENSIONS } from "@/lib/contracts/domain";
import { COMPANY_GROUP, type MetricDefinition } from "@/lib/contracts/metric-query";
import { BUDGET_METRIC_KEY, parseFormula, referencedKeys } from "@/lib/metrics";
import { MONTH_GROUP } from "./explore-state";

export type MetricArea = "Ekonomi" | "AF-program" | "Bemanning" | "Övrigt";

export const METRIC_AREAS: readonly MetricArea[] = ["Ekonomi", "AF-program", "Bemanning", "Övrigt"];

export interface DimensionMeta {
  key: string;
  label: string;
  personal: boolean;
}

/** Seeded dimensions, used when the database list is unavailable. */
export const SEEDED_DIMENSION_META: DimensionMeta[] = Object.entries(SEEDED_DIMENSIONS).map(
  ([key, d]) => ({ key, label: d.label, personal: d.personal }),
);

type DefMap = ReadonlyMap<string, MetricDefinition>;

export function definitionMap(defs: readonly MetricDefinition[]): Map<string, MetricDefinition> {
  return new Map(defs.map((d) => [d.key, d]));
}

/** Non-formula metrics behind a metric (formula operands recursively). */
export function leafMetricKeys(key: string, defs: DefMap, seen = new Set<string>()): string[] {
  const def = defs.get(key);
  if (!def || seen.has(key)) return [];
  seen.add(key);
  if (def.kind !== "formula") return [key];
  let operands: string[];
  try {
    operands = referencedKeys(parseFormula(def.formula ?? ""));
  } catch {
    return [];
  }
  return [...new Set(operands.flatMap((k) => leafMetricKeys(k, defs, seen)))];
}

function areaOfDataset(datasetKey: string | null | undefined): MetricArea {
  if (!datasetKey) return "Övrigt";
  if (datasetKey.startsWith("ip_")) return "Bemanning";
  if (datasetKey.startsWith("wb_")) return "AF-program";
  if (datasetKey.startsWith("fx_") || datasetKey === "budget") return "Ekonomi";
  return "Övrigt";
}

/** Area of a metric; a formula belongs to the area of its first operand's dataset. */
export function metricArea(def: MetricDefinition, defs: DefMap): MetricArea {
  if (def.kind !== "formula") return areaOfDataset(def.datasetKey);
  const first = leafMetricKeys(def.key, defs)[0];
  return areaOfDataset(first ? defs.get(first)?.datasetKey : null);
}

/** Metrics offered in the workspace (the budget carrier is only used as comparison). */
export function selectableMetrics(defs: readonly MetricDefinition[]): MetricDefinition[] {
  return defs.filter((d) => d.key !== BUDGET_METRIC_KEY);
}

export interface MetricGroup {
  area: MetricArea;
  metrics: {
    key: string;
    name: string;
    unit: MetricDefinition["unit"];
    formula: boolean;
    dimensions: string[];
  }[];
}

/** Picker groups in area order, metrics in catalog order within each area. */
export function groupMetricsByArea(defs: readonly MetricDefinition[]): MetricGroup[] {
  const map = definitionMap(defs);
  const groups = new Map<MetricArea, MetricGroup>();
  for (const def of selectableMetrics(defs)) {
    const area = metricArea(def, map);
    const group = groups.get(area) ?? { area, metrics: [] };
    group.metrics.push({
      key: def.key,
      name: def.name,
      unit: def.unit,
      formula: def.kind === "formula",
      dimensions: def.dimensions,
    });
    groups.set(area, group);
  }
  return METRIC_AREAS.flatMap((area) => {
    const g = groups.get(area);
    return g ? [g] : [];
  });
}

/** Whether a metric can be broken down by a breakdown key ("bolag"/"manad" always). */
export function supportsBreakdown(def: MetricDefinition, key: string): boolean {
  return key === COMPANY_GROUP || key === MONTH_GROUP || def.dimensions.includes(key);
}

/** Dimensions supported by at least one of the metrics, in first-seen order. */
export function supportedDimensions(defs: readonly MetricDefinition[]): string[] {
  const out: string[] = [];
  for (const d of defs) for (const k of d.dimensions) if (!out.includes(k)) out.push(k);
  return out;
}

const LEDGER_PHRASE = "bokföringen";

/** Where a metric's numbers come from, as a phrase: "bokföringen", "Workbuster – deltagare". */
export function sourcePhrase(def: MetricDefinition): string {
  if (def.kind === "ledger") return LEDGER_PHRASE;
  if (def.kind === "formula") return `alla delar av ${def.name.toLocaleLowerCase("sv-SE")}`;
  const name = (SEEDED_DATASETS as Record<string, string>)[def.datasetKey ?? ""];
  return name ?? def.datasetKey ?? def.name;
}

export function dimensionLabelOf(key: string, dimensions: readonly DimensionMeta[]): string {
  if (key === COMPANY_GROUP) return "Bolag";
  if (key === MONTH_GROUP) return "Månad";
  return (
    dimensions.find((d) => d.key === key)?.label ??
    (SEEDED_DIMENSIONS as Record<string, { label: string }>)[key]?.label ??
    key
  );
}

/** "Kund finns inte i bokföringen." / "Ort finns inte i Intelliplan – timmar och pass." */
export function notApplicableReason(
  def: MetricDefinition,
  dimensionKeys: readonly string[],
  dimensions: readonly DimensionMeta[],
): string {
  const labels = dimensionKeys.map((k) => dimensionLabelOf(k, dimensions));
  const subject =
    labels.length <= 1
      ? (labels[0] ?? "Uppdelningen")
      : `${labels.slice(0, -1).join(", ")} och ${labels.at(-1)}`;
  return `${subject} finns inte i ${sourcePhrase(def)}.`;
}

/** Personal dimensions (konsult): from the database flags plus the seeded ones. */
export function personalDimensionSet(dimensions: readonly DimensionMeta[]): Set<string> {
  const out = new Set(dimensions.filter((d) => d.personal).map((d) => d.key));
  for (const d of SEEDED_DIMENSION_META) if (d.personal) out.add(d.key);
  return out;
}

/** Name of the entity page of a dimension value: "kundkort" for customers, else "detaljsida". */
export function entityPageName(dimensionKey: string): string {
  return dimensionKey === "kund" ? "kundkort" : "detaljsida";
}

/** "Timmar per kund"; a name that already ends with the breakdown is kept ("Fakturerat per kund"). */
export function perGroupTitle(metricName: string, groupLabel: string): string {
  const suffix = `per ${groupLabel.toLocaleLowerCase("sv-SE")}`;
  return metricName.toLocaleLowerCase("sv-SE").endsWith(suffix)
    ? metricName
    : `${metricName} ${suffix}`;
}
