// Input schemas for the settings server actions. Server actions are reachable by direct POST,
// so every argument is parsed here before it reaches the database.
import { z } from "zod";
import {
  CompanyCodeSchema,
  DimensionKeySchema,
  MetricKeySchema,
  MonthSchema,
  UnitSchema,
} from "@/lib/contracts/domain";
import { formatNumber } from "@/lib/core/format-sv";
import { MAX_ACCOUNT, MAX_RANGES, MIN_ACCOUNT } from "./account-groups";
import { MAX_IMPORT_PAIRS, MAX_LABEL_LENGTH } from "./alias-import";
import { MAX_DECIMALS } from "./metrics";

const text = (max: number) => z.string().trim().max(max);
const required = (max: number, message: string) => text(max).min(1, message);
/** Optional free text: blank becomes null. */
const optionalText = (max: number) =>
  text(max)
    .nullable()
    .transform((v) => (v === null || v === "" ? null : v));

const decimals = z.number().int().min(0).max(MAX_DECIMALS).nullable();
const formula = required(500, "Formeln är tom.");
const id = z.number().int().positive();

const metricFields = {
  name: required(80, "Måttet måste ha ett namn."),
  description: optionalText(500),
  higherIsBetter: z.boolean().nullable(),
  decimals,
  headlineSubject: optionalText(80),
};

export const MetricUpdateSchema = z.object({
  key: MetricKeySchema,
  ...metricFields,
  /** Only for formula metrics. */
  formula: formula.optional(),
});
export type MetricUpdateInput = z.input<typeof MetricUpdateSchema>;

export const NewFormulaMetricSchema = z.object({
  key: MetricKeySchema,
  ...metricFields,
  unit: UnitSchema,
  formula,
});
export type NewFormulaMetricInput = z.input<typeof NewFormulaMetricSchema>;

const account = z.number().int().min(MIN_ACCOUNT).max(MAX_ACCOUNT);

export const AccountGroupUpdateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  name: required(80, "Kontogruppen måste ha ett namn."),
  sign: z.union([z.literal(1), z.literal(-1)]),
  ranges: z
    .array(
      z
        .object({ from: account, to: account })
        .refine(
          (r) => r.from <= r.to,
          "Från-kontot måste vara lägre än eller lika med till-kontot.",
        ),
    )
    .min(1)
    .max(MAX_RANGES),
});
export type AccountGroupUpdateInput = z.input<typeof AccountGroupUpdateSchema>;

export const FiscalStartSchema = z.object({
  company: CompanyCodeSchema,
  month: z.number().int().min(1).max(12),
});

export const PeriodStatusSchema = z.object({
  company: CompanyCodeSchema,
  month: MonthSchema,
  closed: z.boolean(),
});

export const ThresholdSchema = z.object({
  pct: z.number().finite().gt(0).max(1000),
});

export const ValueLabelSchema = z.object({
  id,
  label: required(MAX_LABEL_LENGTH, "Namnet får inte vara tomt."),
});

export const ValueActiveSchema = z.object({ id, active: z.boolean() });

export const AliasSchema = z.object({
  dimensionKey: DimensionKeySchema,
  alias: required(MAX_LABEL_LENGTH, "Aliaset får inte vara tomt."),
  valueId: id,
});

export const AliasDeleteSchema = z.object({
  dimensionKey: DimensionKeySchema,
  alias: required(MAX_LABEL_LENGTH, "Aliaset får inte vara tomt."),
});

export const MergeSchema = z
  .object({ fromId: id, intoId: id })
  .refine((m) => m.fromId !== m.intoId, "Välj två olika värden.");

export const AliasImportSchema = z.object({
  dimensionKey: DimensionKeySchema,
  mode: z.enum(["alias", "relabel"]),
  pairs: z
    .array(
      z.object({
        row: z.number().int().nonnegative(),
        from: z.string().max(MAX_LABEL_LENGTH * 2),
        to: z.string().max(MAX_LABEL_LENGTH * 2),
      }),
    )
    .min(1, "Filen innehåller inga rader att lägga till.")
    .max(MAX_IMPORT_PAIRS, `Högst ${formatNumber(MAX_IMPORT_PAIRS)} rader per import.`),
});
export type AliasImportInput = z.input<typeof AliasImportSchema>;

export const TemplateDeleteSchema = z.object({ id: z.uuid() });

/**
 * First zod issue as a Swedish sentence. Every custom message above contains å, ä or ö;
 * zod's built-in (English) messages never do and get a generic fallback.
 */
export function firstIssue(error: z.ZodError): string {
  const message = error.issues[0]?.message ?? "";
  return /[åäöÅÄÖ]/.test(message) ? message : "Ogiltiga uppgifter.";
}
