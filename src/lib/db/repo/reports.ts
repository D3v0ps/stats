// Board report templates (SlideSpec[]) and frozen reports (immutable ResolvedReport
// snapshots). The database rejects specs that group or filter by a personal dimension.
import { z } from "zod";
import { dateToMonth, monthToDate } from "@/lib/core/month";
import {
  ReportTemplateSpecSchema,
  SlideSpecSchema,
  type ReportTemplateSpec,
  type ResolvedReport,
  type SlideSpec,
} from "@/lib/contracts/slides";
import type { Json, Tables } from "../types";
import { check, isJsonObject, unwrap, unwrapMaybe, type DbClient } from "./shared";

const SlidesSchema = z.array(SlideSpecSchema);

export interface ReportTemplateRecord {
  id: string;
  name: string;
  slides: SlideSpec[];
  updatedAt: string;
}

export function toReportTemplate(row: Tables<"report_templates">): ReportTemplateRecord {
  return {
    id: row.id,
    name: row.name,
    slides: SlidesSchema.parse(row.slides),
    updatedAt: row.updated_at,
  };
}

export async function listReportTemplates(db: DbClient): Promise<ReportTemplateRecord[]> {
  const rows = unwrap(
    "report_templates",
    await db.from("report_templates").select("*").order("name").order("id"),
  );
  return rows.map(toReportTemplate);
}

export async function getReportTemplate(
  db: DbClient,
  id: string,
): Promise<ReportTemplateRecord | null> {
  const row = unwrapMaybe(
    "report_templates",
    await db.from("report_templates").select("*").eq("id", id).maybeSingle(),
  );
  return row ? toReportTemplate(row) : null;
}

export async function createReportTemplate(
  db: DbClient,
  spec: ReportTemplateSpec,
): Promise<ReportTemplateRecord> {
  const parsed = ReportTemplateSpecSchema.parse(spec);
  const row = unwrap(
    "report_templates.insert",
    await db
      .from("report_templates")
      .insert({ name: parsed.name, slides: parsed.slides as unknown as Json })
      .select("*")
      .single(),
  );
  return toReportTemplate(row);
}

export async function updateReportTemplate(
  db: DbClient,
  id: string,
  spec: ReportTemplateSpec,
): Promise<ReportTemplateRecord> {
  const parsed = ReportTemplateSpecSchema.parse(spec);
  const row = unwrap(
    "report_templates.update",
    await db
      .from("report_templates")
      .update({ name: parsed.name, slides: parsed.slides as unknown as Json })
      .eq("id", id)
      .select("*")
      .single(),
  );
  return toReportTemplate(row);
}

export async function deleteReportTemplate(db: DbClient, id: string): Promise<void> {
  check("report_templates.delete", await db.from("report_templates").delete().eq("id", id));
}

// ---- Frozen reports ------------------------------------------------------------

/** What freeze_report stores: the resolved report plus the specs it came from. */
export type FrozenSnapshot = ResolvedReport & { specs: SlideSpec[] };

export function buildSnapshot(report: ResolvedReport, specs: SlideSpec[]): FrozenSnapshot {
  return { ...report, specs: SlidesSchema.parse(specs) };
}

/** Freeze a resolved report. Returns the new board_reports id. */
export async function freezeReport(
  db: DbClient,
  input: { title: string; templateId: string | null; report: ResolvedReport; specs: SlideSpec[] },
): Promise<string> {
  const title = input.title.trim();
  if (title === "") throw new Error("Rapporten behöver en titel");
  return unwrap(
    "freeze_report",
    await db.rpc("freeze_report", {
      p_title: title,
      p_template_id: input.templateId,
      p_anchor: monthToDate(input.report.anchorMonth),
      p_snapshot: buildSnapshot(input.report, input.specs) as unknown as Json,
    }),
  );
}

export interface FrozenReportInfo {
  id: string;
  title: string;
  templateId: string | null;
  anchorMonth: string;
  schemaVersion: number;
  frozenAt: string;
}

export interface FrozenReport extends FrozenReportInfo {
  report: ResolvedReport;
  specs: SlideSpec[];
}

export function toFrozenReport(row: Tables<"board_reports">): FrozenReport {
  const snapshot = row.snapshot;
  if (!isJsonObject(snapshot) || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.slides)) {
    throw new Error(`Rapport ${row.id} har en okänd snapshot-version`);
  }
  const { specs, ...report } = snapshot;
  return {
    id: row.id,
    title: row.title,
    templateId: row.template_id,
    anchorMonth: dateToMonth(row.anchor_month),
    schemaVersion: row.schema_version,
    frozenAt: row.frozen_at,
    report: report as unknown as ResolvedReport,
    // Frozen reports never change but SlideSpecSchema may: specs that no longer parse
    // must not make the archived report unreadable (only the report is rendered).
    specs: SlidesSchema.safeParse(specs ?? []).data ?? [],
  };
}

/** Frozen reports, newest first, without their snapshots. */
export async function listFrozenReports(db: DbClient): Promise<FrozenReportInfo[]> {
  const rows = unwrap(
    "board_reports",
    await db
      .from("board_reports")
      .select("id, title, template_id, anchor_month, schema_version, frozen_at")
      .order("frozen_at", { ascending: false })
      .order("id"),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    templateId: r.template_id,
    anchorMonth: dateToMonth(r.anchor_month),
    schemaVersion: r.schema_version,
    frozenAt: r.frozen_at,
  }));
}

export async function getFrozenReport(db: DbClient, id: string): Promise<FrozenReport | null> {
  const row = unwrapMaybe(
    "board_reports",
    await db.from("board_reports").select("*").eq("id", id).maybeSingle(),
  );
  return row ? toFrozenReport(row) : null;
}
