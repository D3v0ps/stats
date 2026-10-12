// Choices offered by the report template editor. Personal dimensions (konsult) are never
// offered for breakdowns or filters, and a metric only offers the dimensions it has.
import { COMPANY_GROUP, type MetricDefinition } from "@/lib/contracts/metric-query";
import {
  ReportTemplateSpecSchema,
  type ReportTemplateSpec,
  type SlideSpec,
  type VizKind,
} from "@/lib/contracts/slides";
import type { ComparisonKind } from "@/lib/contracts/domain";
import { assertNoPersonalDimensions, normalizeHeadline, PersonalDataError } from "@/lib/metrics";
import { personalDimensionKeys, type ReportDimension } from "./context";

export interface Choice {
  value: string;
  label: string;
}

export type CompareChoice = ComparisonKind | "none";

export const COMPARE_CHOICES: readonly { value: CompareChoice; label: string }[] = [
  { value: "prev_period", label: "Föregående period" },
  { value: "prev_year", label: "Samma period i fjol" },
  { value: "budget", label: "Budget" },
  { value: "none", label: "Ingen" },
];

export function toCompareChoice(compare: ComparisonKind | null): CompareChoice {
  return compare ?? "none";
}

export function fromCompareChoice(value: string): ComparisonKind | null {
  return value === "prev_period" || value === "prev_year" || value === "budget" ? value : null;
}

/** "Ingen" in the breakdown select. */
export const NO_GROUP = "none";

/** Visualisations that break the number down by a dimension (the others ignore groupBy). */
const GROUPING_VIZ: ReadonlySet<VizKind> = new Set(["bar", "donut", "toplist", "table"]);

export function usesGroupBy(viz: VizKind): boolean {
  return GROUPING_VIZ.has(viz);
}

/** Top N limits the groups of a breakdown. */
export function usesTopN(viz: VizKind): boolean {
  return GROUPING_VIZ.has(viz);
}

/** Non-personal dimensions the metric has, in catalog order. */
export function filterableDimensions(
  def: Pick<MetricDefinition, "dimensions"> | undefined,
  dimensions: readonly ReportDimension[],
): ReportDimension[] {
  if (!def) return [];
  const personal = personalDimensionKeys(dimensions);
  const known = new Map(dimensions.map((d) => [d.key, d]));
  return def.dimensions
    .filter((key) => !personal.has(key))
    .map((key) => known.get(key) ?? { key, label: key, personal: false });
}

/** Breakdown options: none, company, then the metric's non-personal dimensions. */
export function groupByChoices(
  def: Pick<MetricDefinition, "dimensions"> | undefined,
  dimensions: readonly ReportDimension[],
): Choice[] {
  return [
    { value: NO_GROUP, label: "Ingen" },
    { value: COMPANY_GROUP, label: "Bolag" },
    ...filterableDimensions(def, dimensions).map((d) => ({ value: d.key, label: d.label })),
  ];
}

/** Metrics sorted by name (Swedish collation). */
export function metricChoices(defs: readonly Pick<MetricDefinition, "key" | "name">[]): Choice[] {
  return [...defs]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((d) => ({ value: d.key, label: d.name }));
}

/** Short text for a slide in the editor's list: the headline override or the metric name. */
export function slideLabel(
  slide: Pick<SlideSpec, "headline" | "metricKey">,
  def: Pick<MetricDefinition, "name"> | undefined,
): string {
  const headline = slide.headline?.trim();
  if (headline) return headline;
  return def?.name ?? slide.metricKey;
}

/**
 * What the live preview resolves: notes and the headline override do not change any number,
 * so typing in them never refetches (the headline is applied locally, see previewHeadline).
 */
export function previewRequest(slide: SlideSpec): SlideSpec {
  return { ...slide, headline: null, notes: "" };
}

/** The headline the deck will show: the override (normalized like the resolver) or the suggestion. */
export function previewHeadline(slide: Pick<SlideSpec, "headline">, suggested: string): string {
  const override = slide.headline?.trim();
  return override ? normalizeHeadline(override) : suggested;
}

/** Button text for a dimension filter: "Alla", "KROM, ROM2" or "3 valda". */
export function filterSummary(
  selectedIds: readonly number[],
  values: readonly { id: number; label: string }[],
): string {
  if (selectedIds.length === 0) return "Alla";
  if (selectedIds.length > 2) return `${selectedIds.length} valda`;
  const labels = new Map(values.map((v) => [v.id, v.label]));
  return selectedIds.map((id) => labels.get(id) ?? "Okänt värde").join(", ");
}

/**
 * cmdk filter for the filter picker: matches the value's label (its keywords), never the
 * numeric id the item is keyed by. Case-insensitive, whitespace-collapsed substring match.
 */
export function filterSearchScore(_value: string, search: string, keywords?: string[]): number {
  const norm = (text: string) => text.toLocaleLowerCase("sv-SE").replace(/\s+/g, " ").trim();
  const query = norm(search);
  if (query === "") return 1;
  return (keywords ?? []).some((k) => norm(k).includes(query)) ? 1 : 0;
}

/** Gentle hints for combinations that render poorly (never errors: the slide still works). */
export function slideHints(slide: SlideSpec): string[] {
  const hints: string[] = [];
  if ((slide.viz === "toplist" || slide.viz === "donut") && slide.groupBy === null) {
    hints.push("Välj en uppdelning, annars visas bara en stapel eller ett segment.");
  }
  if (slide.groupBy === COMPANY_GROUP && slide.company !== "ALL" && usesGroupBy(slide.viz)) {
    hints.push("Uppdelning per bolag visar bara ett bolag när ett enskilt bolag är valt.");
  }
  if (slide.viz === "stacked_company" && slide.company !== "ALL") {
    hints.push("Staplad per bolag visar bägge bolagen när Summa bolag är valt.");
  }
  if (slide.compare === "prev_period" && slide.grain === "ytd") {
    hints.push("Hittills i år jämförs med samma period i fjol.");
  }
  return hints;
}

export type SpecValidation = { ok: true; spec: ReportTemplateSpec } | { ok: false; error: string };

/**
 * Validates a template before it is saved: the shared schema plus the personal-data rule
 * (the database enforces the same rule; this gives a readable message first).
 */
export function validateReportSpec(
  input: unknown,
  dimensions: readonly ReportDimension[],
): SpecValidation {
  const named =
    typeof input === "object" && input !== null && "name" in input && typeof input.name === "string"
      ? { ...input, name: input.name.trim() }
      : input;
  const parsed = ReportTemplateSpecSchema.safeParse(named);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path ?? [];
    if (path[0] === "name")
      return { ok: false, error: "Rapporten behöver ett namn (högst 120 tecken)." };
    if (path[0] === "slides" && typeof path[1] === "number") {
      const field = path[2];
      const what =
        field === "headline"
          ? "rubriken är för lång (högst 80 tecken)"
          : field === "notes"
            ? "talarmanuset är för långt (högst 4 000 tecken)"
            : "inställningarna är ogiltiga";
      return { ok: false, error: `Bild ${path[1] + 1}: ${what}.` };
    }
    return { ok: false, error: "Rapporten kunde inte sparas: ogiltiga inställningar." };
  }
  const ids = new Set<string>();
  for (const slide of parsed.data.slides) {
    if (ids.has(slide.id)) return { ok: false, error: "Två bilder har samma id." };
    ids.add(slide.id);
  }
  const personal = personalDimensionKeys(dimensions);
  try {
    parsed.data.slides.forEach((slide, i) =>
      assertNoPersonalDimensions(slide, personal, `Bild ${i + 1}`),
    );
  } catch (e) {
    if (e instanceof PersonalDataError) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true, spec: parsed.data };
}
