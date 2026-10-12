"use server";

// Server actions for every settings section. Each one re-checks the session, parses its input
// with zod, writes through the signed-in user's client (RLS applies) and returns a Swedish
// ActionResult for the toast. Submitted values are never logged.
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import {
  addAlias,
  deleteAlias,
  ensureDimensionValues,
  listAliases,
  listDimensionValues,
  listDimensions,
  listMetricDefinitions,
  mergeDimensionValues,
  updateDimensionValue,
} from "@/lib/db/repo/catalog";
import { closePeriod, reopenPeriod, setDeviationThresholdPct } from "@/lib/db/repo/settings";
import {
  addAliases,
  createDimensionValues,
  createFormulaMetric,
  relabelDimensionValues,
  replaceAccountGroupRanges,
  setCompanyFiscalStart,
  templateUploadCounts,
  updateAccountGroup,
  updateMetric,
} from "@/lib/db/repo/settings-extra";
import type { DbClient } from "@/lib/db/repo/shared";
import { deleteTemplate } from "@/lib/db/repo/templates";
import { requireSession } from "@/lib/db/session";
import { formatNumber } from "@/lib/core/format-sv";
import { COMPANY_FILTER_LABELS } from "@/lib/contracts/domain";
import { formatMonthLong } from "@/lib/core/month";
import { errorMessage, fail, ok, type ActionResult } from "@/lib/settings-ui/action-result";
import {
  checkSingleAlias,
  importOperations,
  planAliasImport,
  type PlanContext,
} from "@/lib/settings-ui/alias-import";
import { checkFormula } from "@/lib/settings-ui/metrics";
import {
  AccountGroupUpdateSchema,
  AliasDeleteSchema,
  AliasImportSchema,
  AliasSchema,
  FiscalStartSchema,
  MergeSchema,
  MetricUpdateSchema,
  NewFormulaMetricSchema,
  PeriodStatusSchema,
  TemplateDeleteSchema,
  ThresholdSchema,
  ValueActiveSchema,
  ValueLabelSchema,
  firstIssue,
} from "@/lib/settings-ui/schemas";
import { SETTINGS_BASE } from "@/lib/settings-ui/sections";
import type { z } from "zod";

/**
 * Session check (outside the try: its redirect must propagate), input parsing, the write, and
 * revalidation of every settings page on success. Errors become Swedish messages.
 */
async function run<S extends z.ZodType, T>(
  operation: string,
  schema: S,
  input: unknown,
  write: (db: DbClient, data: z.output<S>) => Promise<ActionResult<T>>,
  opts: { revalidate?: boolean } = {},
): Promise<ActionResult<T>> {
  await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    const db = await createSupabaseServerClient();
    const result = await write(db, parsed.data);
    if (result.ok && opts.revalidate !== false) revalidatePath(SETTINGS_BASE, "layout");
    return result;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`[settings] ${operation} failed (${typeof code === "string" ? code : "error"})`);
    return fail(errorMessage(error));
  }
}

// ---- Mått ---------------------------------------------------------------------

export async function updateMetricAction(input: unknown): Promise<ActionResult> {
  return run("updateMetric", MetricUpdateSchema, input, async (db, data) => {
    if (data.formula !== undefined) {
      const definitions = await listMetricDefinitions(db);
      const current = definitions.find((d) => d.key === data.key);
      if (!current) return fail(`Måttet finns inte: ${data.key}`);
      if (current.kind !== "formula") return fail("Bara formelmått har en formel.");
      const check = checkFormula(definitions, data.key, data.formula);
      if (!check.ok) return fail(check.errors[0] ?? "Formeln är ogiltig.");
    }
    await updateMetric(db, data.key, {
      name: data.name,
      description: data.description,
      higherIsBetter: data.higherIsBetter,
      decimals: data.decimals,
      headlineSubject: data.headlineSubject,
      ...(data.formula !== undefined ? { formula: data.formula } : {}),
    });
    return ok(`Måttet ”${data.name}” är sparat.`);
  });
}

export async function createFormulaMetricAction(input: unknown): Promise<ActionResult> {
  return run("createFormulaMetric", NewFormulaMetricSchema, input, async (db, data) => {
    const definitions = await listMetricDefinitions(db);
    if (definitions.some((d) => d.key === data.key)) {
      return fail("Det finns redan ett mått med den nyckeln.");
    }
    const check = checkFormula(definitions, data.key, data.formula);
    if (!check.ok) return fail(check.errors[0] ?? "Formeln är ogiltig.");
    await createFormulaMetric(db, data);
    return ok(`Måttet ”${data.name}” är skapat.`);
  });
}

// ---- Kontogrupper -------------------------------------------------------------

export async function updateAccountGroupAction(input: unknown): Promise<ActionResult> {
  return run("updateAccountGroup", AccountGroupUpdateSchema, input, async (db, data) => {
    await updateAccountGroup(db, data.key, { name: data.name, sign: data.sign });
    await replaceAccountGroupRanges(db, data.key, data.ranges);
    return ok(`Kontogruppen ”${data.name}” är sparad. All historik räknas om.`);
  });
}

// ---- Bolag, perioder, granskning ------------------------------------------------

export async function setFiscalStartAction(input: unknown): Promise<ActionResult> {
  return run("setFiscalStart", FiscalStartSchema, input, async (db, data) => {
    await setCompanyFiscalStart(db, data.company, data.month);
    return ok(`Räkenskapsåret för ${COMPANY_FILTER_LABELS[data.company]} är sparat.`);
  });
}

export async function setPeriodClosedAction(input: unknown): Promise<ActionResult> {
  return run("setPeriodClosed", PeriodStatusSchema, input, async (db, data) => {
    const what = `${formatMonthLong(data.month)} för ${COMPANY_FILTER_LABELS[data.company]}`;
    if (data.closed) {
      await closePeriod(db, data.company, data.month);
      return ok(`${capitalize(what)} är stängd.`);
    }
    await reopenPeriod(db, data.company, data.month);
    return ok(`${capitalize(what)} är öppnad igen.`);
  });
}

export async function setThresholdAction(input: unknown): Promise<ActionResult> {
  return run("setThreshold", ThresholdSchema, input, async (db, data) => {
    await setDeviationThresholdPct(db, data.pct);
    return ok(`Avvikelsegränsen är ${formatNumber(data.pct, data.pct % 1 === 0 ? 0 : 1)} %.`);
  });
}

// ---- Dimensioner och uppslag ----------------------------------------------------

async function planContext(db: DbClient, dimensionKey: string): Promise<PlanContext> {
  const dimension = (await listDimensions(db)).find((d) => d.key === dimensionKey);
  if (!dimension) throw new Error(`Okänd dimension: ${dimensionKey}`);
  const [values, aliases] = await Promise.all([
    listDimensionValues(db, { dimensionKey, includeInactive: true }),
    listAliases(db, dimensionKey),
  ]);
  return { dimensionKey, policy: dimension.unknownPolicy, values, aliases };
}

export async function renameValueAction(input: unknown): Promise<ActionResult> {
  return run("renameValue", ValueLabelSchema, input, async (db, data) => {
    await updateDimensionValue(db, data.id, { label: data.label });
    return ok(`Namnet är ändrat till ”${data.label}”.`);
  });
}

export async function setValueActiveAction(input: unknown): Promise<ActionResult> {
  return run("setValueActive", ValueActiveSchema, input, async (db, data) => {
    await updateDimensionValue(db, data.id, { active: data.active });
    return ok(data.active ? "Värdet är aktivt igen." : "Värdet är inaktiverat.");
  });
}

export async function addAliasAction(input: unknown): Promise<ActionResult> {
  return run("addAlias", AliasSchema, input, async (db, data) => {
    const ctx = await planContext(db, data.dimensionKey);
    if (!ctx.values.some((v) => v.id === data.valueId)) return fail("Värdet finns inte.");
    const check = checkSingleAlias(data.alias, data.valueId, ctx);
    if (check.status === "conflict" || check.status === "invalid") return fail(check.message);
    if (check.status !== "unchanged") {
      await addAlias(db, data.dimensionKey, data.alias, data.valueId);
    }
    return ok(check.message);
  });
}

export async function deleteAliasAction(input: unknown): Promise<ActionResult> {
  return run("deleteAlias", AliasDeleteSchema, input, async (db, data) => {
    await deleteAlias(db, data.dimensionKey, data.alias);
    return ok(`Aliaset ”${data.alias}” är borttaget.`);
  });
}

export async function mergeValuesAction(input: unknown): Promise<ActionResult> {
  return run("mergeValues", MergeSchema, input, async (db, data) => {
    const result = await mergeDimensionValues(db, data.fromId, data.intoId);
    const moved = result.facts + result.ledgerRows;
    return ok(
      moved === 0
        ? "Värdena är sammanslagna."
        : `Värdena är sammanslagna. ${formatNumber(moved)} rader flyttades.`,
    );
  });
}

export async function applyAliasImportAction(
  input: unknown,
): Promise<ActionResult<{ applied: number; flagged: number }>> {
  return run("applyAliasImport", AliasImportSchema, input, async (db, data) => {
    // Plan again on fresh data: the preview may be stale and the input is untrusted.
    const ctx = await planContext(db, data.dimensionKey);
    const plan = planAliasImport(data.pairs, data.mode, ctx);
    const ops = importOperations(plan);

    if (ops.createTargets.length > 0) {
      const created = await ensureDimensionValues(db, data.dimensionKey, ops.createTargets);
      for (const a of ops.aliasesToCreated) {
        const id = created[a.label];
        if (id) ops.aliases.push({ alias: a.alias, valueId: id });
      }
    }
    if (ops.aliases.length > 0) await addAliases(db, data.dimensionKey, ops.aliases);
    if (ops.relabels.length > 0) await relabelDimensionValues(db, ops.relabels);
    if (ops.creates.length > 0) await createDimensionValues(db, data.dimensionKey, ops.creates);

    const summary =
      plan.applicable === 0
        ? "Inget att ändra."
        : `${formatNumber(plan.applicable)} ${plan.applicable === 1 ? "ändring" : "ändringar"} sparade.`;
    const flagged =
      plan.flagged > 0 ? ` ${formatNumber(plan.flagged)} rader behöver rättas i filen.` : "";
    return ok(`${summary}${flagged}`, { applied: plan.applicable, flagged: plan.flagged });
  });
}

// ---- Importmallar ---------------------------------------------------------------

/**
 * Not revalidated: the detail page the user is on would re-render as "not found". The client
 * navigates to the (dynamic, freshly rendered) template list instead.
 */
export async function deleteTemplateAction(input: unknown): Promise<ActionResult> {
  return run(
    "deleteTemplate",
    TemplateDeleteSchema,
    input,
    async (db, data) => {
      const uses = (await templateUploadCounts(db))[data.id] ?? 0;
      if (uses > 0) {
        return fail(
          `Mallen används av ${formatNumber(uses)} ${uses === 1 ? "uppladdning" : "uppladdningar"} och kan inte tas bort.`,
        );
      }
      await deleteTemplate(db, data.id);
      return ok("Mallen är borttagen.");
    },
    { revalidate: false },
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("sv") + text.slice(1);
}
