"use server";

// Server Actions of the upload flow. Each one re-checks the session, validates
// its input with zod and works through the signed-in user's client (RLS).
// Only templates, aggregated facts/ledger rows and dimension labels arrive here.
import type { z } from "zod";
import type { ImportTemplate } from "@/lib/contracts";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import {
  addAlias,
  createTemplate,
  createTemplateVersion,
  createUpload,
  discardUpload,
  ensureDimensionValues,
  getTemplate,
  getUpload,
  listMetricDefinitions,
  loadDimensionDictionary,
  publishUpload,
  reviewCompare,
  stageFacts,
  stageLedger,
  type DbClient,
  type DimensionDictionaryEntry,
  type LedgerStageResult,
  type PublishSummary,
  type ReviewComparison,
  type StoredTemplate,
} from "@/lib/db/repo";
import {
  createMetric,
  findPublishedFiles,
  type CreatedMetric,
  type PublishedFile,
} from "@/lib/db/repo/import-extra";
import { requireSession } from "@/lib/db/session";
import {
  AddAliasInputSchema,
  CreateMetricInputSchema,
  CreateUploadInputSchema,
  DictionaryInputSchema,
  EnsureValuesInputSchema,
  FindPublishedInputSchema,
  INVALID_INPUT,
  SaveTemplateInputSchema,
  StageFactsInputSchema,
  StageLedgerInputSchema,
  UploadIdInputSchema,
  type ActionResult,
} from "@/lib/import-ui/action-schemas";
import { actionErrorMessage } from "@/lib/import-ui/errors";
import { headlineSubjectFor, metricKeyFromName } from "@/lib/import-ui/metric-key";

async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (db: DbClient, data: z.infer<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  // Outside try: an expired session redirects to the login page.
  await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INPUT };
  try {
    const db = await createSupabaseServerClient();
    return { ok: true, data: await fn(db, parsed.data) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

/** Published uploads of these files (duplicate check). */
export async function findPublishedAction(input: {
  sha256s: string[];
}): Promise<ActionResult<PublishedFile[]>> {
  return run(FindPublishedInputSchema, input, (db, d) => findPublishedFiles(db, d.sha256s));
}

/** Dimension dictionaries (labels, codes, aliases -> id) for resolving and lookups. */
export async function loadDictionariesAction(input: {
  dimensions: string[];
}): Promise<ActionResult<Record<string, DimensionDictionaryEntry>>> {
  return run(DictionaryInputSchema, input, (db, d) =>
    d.dimensions.length === 0 ? Promise.resolve({}) : loadDimensionDictionary(db, d.dimensions),
  );
}

/** Save a mapping: a new template, or a new version of an existing one. */
export async function saveTemplateAction(input: {
  templateId: string | null;
  template: ImportTemplate;
}): Promise<ActionResult<StoredTemplate>> {
  return run(SaveTemplateInputSchema, input, async (db, d) => {
    if (!d.templateId) return createTemplate(db, d.template);
    await createTemplateVersion(db, d.templateId, {
      config: d.template.config,
      headerSignature: d.template.headerSignature,
      sheetHint: d.template.sheetHint ?? null,
      name: d.template.name,
    });
    const saved = await getTemplate(db, d.templateId);
    if (!saved) throw new Error("Mallen kunde inte läsas efter att den sparats.");
    return saved;
  });
}

/** "Nytt mått…" from the mapping view. */
export async function createMetricAction(input: {
  datasetKey: string;
  name: string;
  unit: "st" | "kr" | "h" | "pct";
  kind: "sum" | "snapshot";
  higherIsBetter: boolean | null;
}): Promise<ActionResult<CreatedMetric>> {
  return run(CreateMetricInputSchema, input, async (db, d) => {
    const existing = (await listMetricDefinitions(db)).map((m) => m.key);
    return createMetric(db, {
      key: metricKeyFromName(d.name, existing),
      name: d.name,
      unit: d.unit,
      kind: d.kind,
      datasetKey: d.datasetKey,
      higherIsBetter: d.higherIsBetter,
      headlineSubject: headlineSubjectFor(d.name),
    });
  });
}

/** Create (or look up) dimension values; force adds values of "ask" dimensions ("Lägg till som ny"). */
export async function ensureValuesAction(input: {
  dimension: string;
  labels: string[];
  force: boolean;
}): Promise<ActionResult<Record<string, number | null>>> {
  return run(EnsureValuesInputSchema, input, (db, d) =>
    ensureDimensionValues(db, d.dimension, d.labels, { force: d.force }),
  );
}

/** "Samma som…": remember a spelling as an alias of an existing value. */
export async function addAliasAction(input: {
  dimension: string;
  alias: string;
  valueId: number;
}): Promise<ActionResult<null>> {
  return run(AddAliasInputSchema, input, async (db, d) => {
    await addAlias(db, d.dimension, d.alias, d.valueId);
    return null;
  });
}

export async function createUploadAction(input: unknown): Promise<ActionResult<string>> {
  return run(CreateUploadInputSchema, input, (db, d) => createUpload(db, d));
}

export async function stageFactsAction(input: unknown): Promise<ActionResult<number>> {
  return run(StageFactsInputSchema, input, (db, d) => stageFacts(db, d.uploadId, d.facts));
}

export async function stageLedgerAction(input: unknown): Promise<ActionResult<LedgerStageResult>> {
  return run(StageLedgerInputSchema, input, (db, d) =>
    stageLedger(db, d.uploadId, { rows: d.rows, accounts: d.accounts, objects: d.objects }),
  );
}

export async function compareUploadAction(input: {
  uploadId: string;
}): Promise<ActionResult<ReviewComparison>> {
  return run(UploadIdInputSchema, input, (db, d) => reviewCompare(db, d.uploadId));
}

export interface PublishOutcome {
  summary: PublishSummary;
  /** published_at of the newest upload this one replaced, if any. */
  replacedPublishedAt: string | null;
}

export async function publishUploadAction(input: {
  uploadId: string;
}): Promise<ActionResult<PublishOutcome>> {
  return run(UploadIdInputSchema, input, async (db, d) => {
    const summary = await publishUpload(db, d.uploadId);
    let replacedPublishedAt: string | null = null;
    for (const id of summary.superseded) {
      const previous = await getUpload(db, id);
      if (
        previous?.publishedAt &&
        (!replacedPublishedAt || previous.publishedAt > replacedPublishedAt)
      ) {
        replacedPublishedAt = previous.publishedAt;
      }
    }
    return { summary, replacedPublishedAt };
  });
}

export async function discardUploadAction(input: {
  uploadId: string;
}): Promise<ActionResult<null>> {
  return run(UploadIdInputSchema, input, async (db, d) => {
    await discardUpload(db, d.uploadId);
    return null;
  });
}
