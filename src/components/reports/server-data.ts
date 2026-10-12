import "server-only";

// Server-side loading and resolving for report pages and actions. Everything reads through
// the signed-in user's Supabase client (RLS applies); callers must have called
// requireSession() first. Numbers are always resolved here, never taken from the client.
import { cache } from "react";
import { z } from "zod";
import type {
  ReportTemplateSpec,
  ResolvedReport,
  ResolvedSlide,
  SlideSpec,
} from "@/lib/contracts/slides";
import { isMonth, lastClosedMonth, type Month } from "@/lib/core/month";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { getMetricSource } from "@/lib/db/metric-source";
import {
  getFrozenReport,
  getReportTemplate,
  listDimensions,
  type FrozenReport,
} from "@/lib/db/repo";
import { resolveReport, resolveSlide } from "@/lib/metrics";
import { defaultAnchorMonth } from "@/lib/metrics/anchor";
import { buildReportContext } from "@/lib/present/context";
import { describeReportError } from "@/lib/present/errors";
import { defaultFreezeTitle, monthOptionsWith, type MonthOption } from "@/lib/present/freeze";

/** Supabase client, metric source and catalog for one request. */
export const getReportData = cache(async () => {
  const [db, source] = await Promise.all([createSupabaseServerClient(), getMetricSource()]);
  const [definitions, dimensions] = await Promise.all([source.definitions(), listDimensions(db)]);
  return { db, source, definitions, dimensions };
});

/** ?manad=YYYY-MM when valid, otherwise the latest complete month. */
export async function reportAnchor(manad?: string | string[] | null): Promise<Month> {
  const value = Array.isArray(manad) ? manad[0] : manad;
  if (isMonth(value)) return value;
  const { source } = await getReportData();
  return (await defaultAnchorMonth(source, new Date())).month;
}

export interface FreezeDefaults {
  defaultTitle: string;
  months: MonthOption[];
  defaultMonth: Month;
}

/** Freeze dialog defaults: "Styrelsemöte v.<this week>" and the report's month. */
export function freezeDefaults(anchor: Month, now: Date = new Date()): FreezeDefaults {
  return {
    defaultTitle: defaultFreezeTitle(now),
    months: monthOptionsWith(lastClosedMonth(now), anchor),
    defaultMonth: anchor,
  };
}

async function contextFor(anchor: Month, title: string) {
  const { source, definitions, dimensions } = await getReportData();
  return buildReportContext({ anchor, title, source, definitions, dimensions });
}

/** Resolve a template (refuses personal dimensions before querying anything). */
export async function resolveTemplate(
  spec: ReportTemplateSpec,
  anchor: Month,
  title: string = spec.name,
): Promise<ResolvedReport> {
  return resolveReport(spec, await contextFor(anchor, title));
}

export async function resolvePreview(spec: SlideSpec, anchor: Month): Promise<ResolvedSlide> {
  return resolveSlide(spec, await contextFor(anchor, ""));
}

/** Name and code only: messages can echo query details and payloads are never logged. */
export function logReportError(error: unknown): void {
  const name = error instanceof Error ? error.name : "Error";
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[rapporter] ${name}${typeof code === "string" ? ` (${code})` : ""}`);
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Run a data step and turn failures into a Swedish message for the page. Do not call
 * notFound() or redirect() inside `step`: their control-flow errors would be swallowed.
 */
export async function attempt<T>(step: () => Promise<T>, fallback?: string): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await step() };
  } catch (error) {
    logReportError(error);
    return { ok: false, error: describeReportError(error, fallback) };
  }
}

export type Loaded<T> =
  { kind: "ok"; value: T } | { kind: "not_found" } | { kind: "error"; error: string };

const GuidSchema = z.guid();

/** A template resolved for ?manad (or the latest complete month), for the deck and notes. */
export async function loadTemplateReport(
  templateId: string,
  manad?: string | string[],
): Promise<Loaded<{ report: ResolvedReport; anchor: Month }>> {
  if (!GuidSchema.safeParse(templateId).success) return { kind: "not_found" };
  const result = await attempt(async () => {
    const { db } = await getReportData();
    const template = await getReportTemplate(db, templateId);
    if (!template) return null;
    const anchor = await reportAnchor(manad);
    const report = await resolveTemplate({ name: template.name, slides: template.slides }, anchor);
    return { report, anchor };
  });
  if (!result.ok) return { kind: "error", error: result.error };
  return result.value ? { kind: "ok", value: result.value } : { kind: "not_found" };
}

/** A frozen report exactly as stored (never recomputed). */
export async function loadFrozenReport(id: string): Promise<Loaded<FrozenReport>> {
  if (!GuidSchema.safeParse(id).success) return { kind: "not_found" };
  const result = await attempt(async () => {
    const { db } = await getReportData();
    return getFrozenReport(db, id);
  }, "Rapporten kunde inte hämtas just nu. Försök igen om en stund.");
  if (!result.ok) return { kind: "error", error: result.error };
  return result.value ? { kind: "ok", value: result.value } : { kind: "not_found" };
}
