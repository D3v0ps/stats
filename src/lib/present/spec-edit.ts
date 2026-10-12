// Immutable editing operations on a template's slides (add, duplicate, delete, reorder,
// change). The editor keeps SlideSpec[] in state and applies these.
import { COMPANY_GROUP, type MetricDefinition } from "@/lib/contracts/metric-query";
import { SlideSpecSchema, type SlideSpec } from "@/lib/contracts/slides";
import { filterableDimensions } from "./editor-options";
import type { ReportDimension } from "./context";

export const DEFAULT_NEW_METRIC = "aktiva_deltagare";

/** A short slide id ("s-k3j9x0ab") that no slide in `slides` uses yet. */
export function newSlideId(
  slides: readonly Pick<SlideSpec, "id">[] = [],
  random: () => number = Math.random,
): string {
  const taken = new Set(slides.map((s) => s.id));
  for (;;) {
    const id = `s-${Math.floor(random() * 36 ** 8)
      .toString(36)
      .padStart(8, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** A fresh KPI slide for the latest month, compared with the previous month. */
export function createSlide(id: string, metricKey: string = DEFAULT_NEW_METRIC): SlideSpec {
  return SlideSpecSchema.parse({ id, viz: "kpi", metricKey, grain: "month", company: "ALL" });
}

/** Insert after `afterId` (or at the end). */
export function insertSlide(
  slides: readonly SlideSpec[],
  slide: SlideSpec,
  afterId?: string | null,
): SlideSpec[] {
  const at = afterId ? slides.findIndex((s) => s.id === afterId) : -1;
  if (at < 0) return [...slides, slide];
  return [...slides.slice(0, at + 1), slide, ...slides.slice(at + 1)];
}

/** Copy a slide (new id) right after the original. */
export function duplicateSlide(
  slides: readonly SlideSpec[],
  id: string,
  newId: string,
): SlideSpec[] {
  const original = slides.find((s) => s.id === id);
  if (!original) return [...slides];
  const copy: SlideSpec = structuredClone({ ...original, id: newId });
  return insertSlide(slides, copy, id);
}

export function removeSlide(slides: readonly SlideSpec[], id: string): SlideSpec[] {
  return slides.filter((s) => s.id !== id);
}

/** The slide to select after removing `id`: the next one, else the previous, else none. */
export function neighbourAfterRemoval(slides: readonly SlideSpec[], id: string): string | null {
  const i = slides.findIndex((s) => s.id === id);
  if (i < 0) return slides[0]?.id ?? null;
  return slides[i + 1]?.id ?? slides[i - 1]?.id ?? null;
}

/** Move the slide `activeId` to the position of `overId` (drag and drop). */
export function moveSlide(
  slides: readonly SlideSpec[],
  activeId: string,
  overId: string,
): SlideSpec[] {
  const from = slides.findIndex((s) => s.id === activeId);
  const to = slides.findIndex((s) => s.id === overId);
  if (from < 0 || to < 0 || from === to) return [...slides];
  const next = [...slides];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as SlideSpec);
  return next;
}

/** Move one step up (-1) or down (+1); unchanged at the ends. */
export function moveSlideBy(slides: readonly SlideSpec[], id: string, delta: -1 | 1): SlideSpec[] {
  const from = slides.findIndex((s) => s.id === id);
  const target = slides[from + delta];
  if (from < 0 || !target) return [...slides];
  return moveSlide(slides, id, target.id);
}

/** Replace fields of one slide. */
export function patchSlide(
  slides: readonly SlideSpec[],
  id: string,
  patch: Partial<Omit<SlideSpec, "id">>,
): SlideSpec[] {
  return slides.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/**
 * Switch a slide to another metric, dropping a breakdown or filters the new metric does not
 * have (they would make the slide "not applicable") and anything personal.
 */
export function withMetric(
  slide: SlideSpec,
  def: Pick<MetricDefinition, "key" | "dimensions">,
  dimensions: readonly ReportDimension[],
): SlideSpec {
  const allowed = new Set(filterableDimensions(def, dimensions).map((d) => d.key));
  const groupBy =
    slide.groupBy === null || slide.groupBy === COMPANY_GROUP || allowed.has(slide.groupBy)
      ? slide.groupBy
      : null;
  return {
    ...slide,
    metricKey: def.key,
    groupBy,
    filters: slide.filters.filter((f) => allowed.has(f.dimension)),
  };
}

/** Toggle one value of a dimension filter; an empty filter is removed (filters need values). */
export function toggleFilterValue(slide: SlideSpec, dimension: string, valueId: number): SlideSpec {
  const existing = slide.filters.find((f) => f.dimension === dimension);
  if (!existing) {
    return { ...slide, filters: [...slide.filters, { dimension, valueIds: [valueId] }] };
  }
  const valueIds = existing.valueIds.includes(valueId)
    ? existing.valueIds.filter((v) => v !== valueId)
    : [...existing.valueIds, valueId];
  return {
    ...slide,
    filters:
      valueIds.length === 0
        ? slide.filters.filter((f) => f.dimension !== dimension)
        : slide.filters.map((f) => (f.dimension === dimension ? { dimension, valueIds } : f)),
  };
}

export function clearFilter(slide: SlideSpec, dimension: string): SlideSpec {
  return { ...slide, filters: slide.filters.filter((f) => f.dimension !== dimension) };
}

/** Parse a "Topp N" input: blank = default (null), otherwise a positive whole number. */
export function parseTopN(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,3}$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 ? n : undefined;
}

/** JSON for dirty checks; patches keep key order, so equal specs give equal strings. */
export function specFingerprint(name: string, slides: readonly SlideSpec[]): string {
  return JSON.stringify({ name, slides });
}
