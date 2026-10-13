// Report templates and frozen reports for the view specs. Templates are inserted and deleted
// through the service role; freezing goes through the UI, because freeze_report resolves the
// numbers on the server for a signed-in app user. Frozen reports can never be deleted, so specs
// that need one look it up by a fixed title first and freeze only when it is missing.
import { expect, type Page } from "@playwright/test";
import { formatNumber } from "@/lib/core/format-sv";
import type { ReportTemplateSpec } from "@/lib/contracts/slides";
import { createReportTemplate, deleteReportTemplate } from "@/lib/db/repo/reports";
import { defaultReportSpec } from "@/lib/present/default-report";
import { monthTitle } from "@/lib/present/labels";
import { createE2eAdminClient } from "./admin";
import { resolveLocalSupabase } from "./local-supabase";

/** The month every report view shows: the last month the fixtures cover. */
export const REPORT_MONTH = "2026-09";

/** Slides in the standard report. */
export const STANDARD_SLIDES = defaultReportSpec().slides.length;

/** A slide's name in a deck and its notes window, e.g. "Bild 3 av 9". */
export const slideName = (n: number, count = STANDARD_SLIDES) =>
  `Bild ${formatNumber(n)} av ${formatNumber(count)}`;

const admin = () => createE2eAdminClient(resolveLocalSupabase());

export async function insertReportTemplate(spec: ReportTemplateSpec): Promise<string> {
  return (await createReportTemplate(admin(), spec)).id;
}

export async function removeReportTemplate(id: string): Promise<void> {
  await deleteReportTemplate(admin(), id);
}

export async function reportTemplateCount(): Promise<number> {
  const { count, error } = await admin()
    .from("report_templates")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count report templates (${error.code}).`);
  return count ?? 0;
}

/** The oldest frozen report with this title, if any. */
export async function frozenReportByTitle(title: string): Promise<string | null> {
  const { data, error } = await admin()
    .from("board_reports")
    .select("id")
    .eq("title", title)
    .order("frozen_at")
    .limit(1);
  if (error) throw new Error(`Could not read frozen reports (${error.code}).`);
  return data[0]?.id ?? null;
}

/** The stored snapshot of a frozen report, as JSON text. */
export async function frozenSnapshot(id: string): Promise<string> {
  const { data, error } = await admin()
    .from("board_reports")
    .select("snapshot")
    .eq("id", id)
    .single();
  if (error) throw new Error(`Could not read the frozen report (${error.code}).`);
  return JSON.stringify(data.snapshot);
}

/** Freezes a saved template from its editor and returns the new frozen report's id. */
export async function freezeThroughUi(
  page: Page,
  templateId: string,
  title: string,
  month = REPORT_MONTH,
): Promise<string> {
  await page.goto(`/rapporter/${templateId}`);
  await page.getByTestId("freeze-open").click();
  const dialog = page.getByRole("dialog", { name: "Frys rapport" });
  await dialog.getByTestId("freeze-title").fill(title);
  await dialog.getByTestId("freeze-month").click();
  await page.getByRole("option", { name: monthTitle(month), exact: true }).click();
  await dialog.getByTestId("freeze-submit").click();
  await page.waitForURL(/\/rapporter\/arkiv\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop();
  if (!id) throw new Error("The frozen report's id is missing from the URL.");
  return id;
}

/** Title of the frozen standard report the view specs share (see frozenStandardReport). */
export const FROZEN_STANDARD_TITLE = "E2E standardrapport";

/**
 * The shared frozen standard report: found by its title, or frozen now from a template that is
 * deleted again (the frozen report keeps no link it needs).
 */
export async function frozenStandardReport(page: Page): Promise<string> {
  const existing = await frozenReportByTitle(FROZEN_STANDARD_TITLE);
  if (existing) return existing;
  const template = await insertReportTemplate(defaultReportSpec(FROZEN_STANDARD_TITLE));
  try {
    return await freezeThroughUi(page, template, FROZEN_STANDARD_TITLE);
  } finally {
    await removeReportTemplate(template);
  }
}
