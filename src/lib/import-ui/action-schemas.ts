// Input validation for the upload page's Server Actions. Every action is a
// public POST endpoint, so its arguments are parsed with these schemas before
// anything touches the database.
import { z } from "zod";
import {
  CompanyCodeSchema,
  DimensionKeySchema,
  FactRowSchema,
  ImportTemplateSchema,
  LedgerRowSchema,
  UploadCreateSchema,
} from "@/lib/contracts";
import { NewMetricSchema } from "./metric-key";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Uuid = z.string().uuid();
/** Rows per staging request (chunks are smaller; this is the hard cap). */
export const MAX_ROWS_PER_REQUEST = 5000;

export const FindPublishedInputSchema = z.object({
  sha256s: z.array(Sha256).max(200),
});

export const DictionaryInputSchema = z.object({
  dimensions: z.array(DimensionKeySchema).max(30),
});

export const SaveTemplateInputSchema = z.object({
  /** Existing template: a new version is saved; null creates a template. */
  templateId: Uuid.nullable(),
  template: ImportTemplateSchema,
});

export const CreateMetricInputSchema = NewMetricSchema;

export const EnsureValuesInputSchema = z.object({
  dimension: DimensionKeySchema,
  labels: z.array(z.string().trim().min(1).max(200)).min(1).max(2000),
  /** Create values even for dimensions whose unknown values need a decision ("Lägg till som ny"). */
  force: z.boolean(),
});

export const AddAliasInputSchema = z.object({
  dimension: DimensionKeySchema,
  alias: z.string().trim().min(1).max(200),
  valueId: z.number().int().positive(),
});

export const CreateUploadInputSchema = UploadCreateSchema;

export const StageFactsInputSchema = z.object({
  uploadId: Uuid,
  facts: z.array(FactRowSchema).min(1).max(MAX_ROWS_PER_REQUEST),
});

export const StageLedgerInputSchema = z.object({
  uploadId: Uuid,
  rows: z.array(LedgerRowSchema).max(MAX_ROWS_PER_REQUEST),
  accounts: z
    .array(
      z.object({
        company: CompanyCodeSchema,
        account: z.number().int().min(1000).max(9999),
        name: z.string().max(200),
      }),
    )
    .max(MAX_ROWS_PER_REQUEST),
  objects: z
    .array(
      z.object({
        company: CompanyCodeSchema,
        dimNo: z.number().int().positive(),
        code: z.string().min(1).max(100),
        name: z.string().max(200),
      }),
    )
    .max(MAX_ROWS_PER_REQUEST),
});

export const UploadIdInputSchema = z.object({ uploadId: Uuid });

/** Server Action result: data, or a Swedish message for the page. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Message for an invalid action input (never echoes the input). */
export const INVALID_INPUT = "Uppgifterna kunde inte tas emot. Ladda om sidan och försök igen.";
