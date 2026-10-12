"use server";

// Server actions for report templates, the editor preview and freezing. Every action checks
// the session, validates its input and reads data through the user's own client (RLS).
// Freezing re-resolves the report here: numbers sent by a client are never trusted.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SlideSpecSchema, type ResolvedSlide } from "@/lib/contracts/slides";
import { isMonth } from "@/lib/core/month";
import {
  createReportTemplate,
  deleteReportTemplate,
  freezeReport,
  getReportTemplate,
  updateReportTemplate,
} from "@/lib/db/repo";
import { requireSession } from "@/lib/db/session";
import { assertNoPersonalDimensions } from "@/lib/metrics";
import { personalDimensionKeys } from "@/lib/present/context";
import { defaultReportSpec } from "@/lib/present/default-report";
import { validateReportSpec } from "@/lib/present/editor-options";
import { describeReportError } from "@/lib/present/errors";
import { FreezeInputSchema, freezeInputError } from "@/lib/present/freeze";
import { createSlide, newSlideId } from "@/lib/present/spec-edit";
import {
  getReportData,
  logReportError,
  resolvePreview,
  resolveTemplate,
} from "@/components/reports/server-data";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const IdSchema = z.guid();
const REPORTS_PATH = "/rapporter";

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  logReportError(error);
  return { ok: false, error: describeReportError(error, fallback) };
}

/** Creates the standard board report (Skapa standardrapport). */
export async function createDefaultTemplateAction(): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  try {
    const { db } = await getReportData();
    const template = await createReportTemplate(db, defaultReportSpec());
    revalidatePath(REPORTS_PATH);
    return { ok: true, data: { id: template.id } };
  } catch (error) {
    return failure(error, "Standardrapporten kunde inte skapas. Försök igen.");
  }
}

/** Creates a new report with one KPI slide. */
export async function createBlankTemplateAction(): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  try {
    const { db } = await getReportData();
    const template = await createReportTemplate(db, {
      name: "Ny rapport",
      slides: [createSlide(newSlideId())],
    });
    revalidatePath(REPORTS_PATH);
    return { ok: true, data: { id: template.id } };
  } catch (error) {
    return failure(error, "Rapporten kunde inte skapas. Försök igen.");
  }
}

export async function saveTemplateAction(
  id: string,
  spec: unknown,
): Promise<ActionResult<{ updatedAt: string }>> {
  await requireSession();
  if (!IdSchema.safeParse(id).success) return { ok: false, error: "Okänd rapportmall." };
  try {
    const { db, dimensions } = await getReportData();
    const valid = validateReportSpec(spec, dimensions);
    if (!valid.ok) return { ok: false, error: valid.error };
    const saved = await updateReportTemplate(db, id, valid.spec);
    revalidatePath(REPORTS_PATH);
    return { ok: true, data: { updatedAt: saved.updatedAt } };
  } catch (error) {
    return failure(error, "Rapporten kunde inte sparas. Försök igen.");
  }
}

export async function deleteTemplateAction(id: string): Promise<ActionResult<null>> {
  await requireSession();
  if (!IdSchema.safeParse(id).success) return { ok: false, error: "Okänd rapportmall." };
  try {
    const { db } = await getReportData();
    await deleteReportTemplate(db, id);
    revalidatePath(REPORTS_PATH);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, "Rapporten kunde inte tas bort. Försök igen.");
  }
}

/** Live preview of one slide in the editor, resolved server-side for the anchor month. */
export async function previewSlideAction(
  spec: unknown,
  anchor: string,
): Promise<ActionResult<ResolvedSlide>> {
  await requireSession();
  const parsed = SlideSpecSchema.safeParse(spec);
  if (!parsed.success || !isMonth(anchor)) {
    return { ok: false, error: "Bilden har ogiltiga inställningar." };
  }
  try {
    return { ok: true, data: await resolvePreview(parsed.data, anchor) };
  } catch (error) {
    return failure(error, "Förhandsvisningen kunde inte tas fram.");
  }
}

/**
 * Freezes a template for a month: loads the saved template, resolves it on the server over
 * the published data, refuses personal dimensions and stores the immutable snapshot.
 */
export async function freezeReportAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  const parsed = FreezeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: freezeInputError(input) ?? "Ogiltiga uppgifter." };
  }
  const { templateId, title, month } = parsed.data;
  try {
    const { db, dimensions } = await getReportData();
    const template = await getReportTemplate(db, templateId);
    if (!template) return { ok: false, error: "Rapportmallen finns inte längre." };
    if (template.slides.length === 0) {
      return { ok: false, error: "Rapporten har inga bilder att frysa." };
    }
    const personal = personalDimensionKeys(dimensions);
    template.slides.forEach((slide, i) =>
      assertNoPersonalDimensions(slide, personal, `Bild ${i + 1}`),
    );
    const report = await resolveTemplate(
      { name: template.name, slides: template.slides },
      month,
      title,
    );
    const id = await freezeReport(db, {
      title,
      templateId: template.id,
      report,
      specs: template.slides,
    });
    revalidatePath(REPORTS_PATH);
    return { ok: true, data: { id } };
  } catch (error) {
    return failure(error, "Rapporten kunde inte frysas. Försök igen.");
  }
}
