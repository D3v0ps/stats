// Import templates: the replayable list of mapping steps plus the column mapping.
// A template is applied to a DetectedTable to produce typed rows, which ingest
// aggregates into facts. Steps reference columns by their current working name
// (the normalized source header, or the name given by an earlier rename/merge/split).
import { z } from "zod";
import {
  CompanyCodeSchema,
  DatasetKeySchema,
  DimensionKeySchema,
  IsoDateSchema,
  MetricKeySchema,
  MonthSchema,
  ScenarioSchema,
} from "./domain";

export const ColumnTypeSchema = z.enum(["text", "number", "amount", "hours", "date", "percent"]);
export type ColumnType = z.infer<typeof ColumnTypeSchema>;

/** Swedish UI labels for column types. */
export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Text",
  number: "Tal",
  amount: "Belopp (kr)",
  hours: "Timmar",
  date: "Datum",
  percent: "Procent",
};

export const ColumnUsageSchema = z.enum([
  "measure",
  "dimension",
  "period",
  "company",
  "ignore",
  // cases templates
  "case_key",
  "case_start",
  "case_end",
  "case_interrupt",
  "case_result",
  "case_result_date",
]);
export type ColumnUsage = z.infer<typeof ColumnUsageSchema>;

/** Plain-Swedish labels shown in the mapping view. */
export const COLUMN_USAGE_LABELS: Record<ColumnUsage, string> = {
  measure: "Siffra att räkna på",
  dimension: "Gruppera på",
  period: "Datum/period",
  company: "Bolag",
  ignore: "Ta inte med",
  case_key: "Id (räknas, sparas inte)",
  case_start: "Startdatum",
  case_end: "Slutdatum",
  case_interrupt: "Avbrott",
  case_result: "Resultat",
  case_result_date: "Resultatdatum",
};

const col = z.string().min(1);

export const StepSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), column: col, to: col }),
  z.object({ op: z.literal("drop"), column: col }),
  z.object({
    op: z.literal("merge"),
    columns: z.array(col).min(2),
    separator: z.string(),
    into: col,
  }),
  z.object({
    op: z.literal("split"),
    column: col,
    /** delimiter: split on `delimiter`; year_month: "2026-09" -> year, month; last_first: "Efternamn, Förnamn" -> first, last */
    mode: z.enum(["delimiter", "year_month", "last_first"]),
    delimiter: z.string().optional(),
    into: z.array(col).min(2),
  }),
  z.object({
    op: z.literal("replace"),
    column: col,
    find: z.string(),
    replace: z.string(),
    match: z.enum(["contains", "whole_cell"]),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({
    op: z.literal("clean"),
    column: col,
    /** Strip units/formatting: "8,5 h" -> 8.5, "1 200 kr" -> 1200, "12 %" -> 12, trim text. */
    as: z.enum(["number", "amount", "hours", "percent", "trim"]),
  }),
  z.object({
    op: z.literal("lookup"),
    column: col,
    /** Translate values through this dimension's alias table (code/spelling -> canonical label). */
    dimension: DimensionKeySchema,
  }),
  z.object({
    op: z.literal("filter"),
    column: col,
    /** Rows that MATCH are removed ("Filtrera bort rader"). */
    operator: z.enum(["equals", "not_equals", "contains", "empty", "not_empty"]),
    value: z.string().optional(),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({ op: z.literal("reorder"), order: z.array(col) }),
  z.object({
    op: z.literal("unpivot"),
    /** Wide -> long: each listed column becomes a row with its header in nameColumn. */
    columns: z.array(col).min(1),
    nameColumn: col,
    valueColumn: col,
  }),
  /** Fill empty cells with the value above (grouped reports, merged cells). */
  z.object({ op: z.literal("fill_down"), column: col }),
  /** Multiply numeric values by -1 (e.g. budget costs given as negatives). */
  z.object({ op: z.literal("negate"), column: col }),
  /** Add a column with a fixed value, e.g. Verksamhet = "Bemanning". */
  z.object({ op: z.literal("constant"), column: col, value: z.string() }),
]);
export type Step = z.infer<typeof StepSchema>;
export type StepOp = Step["op"];

export const ColumnMappingSchema = z.object({
  /** Working name after steps. */
  column: col,
  type: ColumnTypeSchema,
  usage: ColumnUsageSchema,
  /** For usage=measure: which metric the column feeds. */
  metricKey: MetricKeySchema.optional(),
  /** For usage=dimension: which dimension the values belong to. */
  dimensionKey: DimensionKeySchema.optional(),
  /** Detected as personal data (name/e-mail/phone/address). Defaults to removed. */
  personal: z.boolean().default(false),
  /** false = removed; removed columns never leave the browser. */
  keep: z.boolean().default(true),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

/** Extra measures that count rows (e.g. number of sick shifts). */
export const CounterSchema = z.object({
  metricKey: MetricKeySchema,
  kind: z.literal("count_rows"),
});
export type Counter = z.infer<typeof CounterSchema>;

export const PeriodSourceSchema = z.discriminatedUnion("kind", [
  /** A date or month column; each row is assigned to its month. */
  z.object({ kind: z.literal("column"), column: col }),
  /** The whole file is one month, chosen/confirmed at import (suggested from filename/meta). */
  z.object({ kind: z.literal("per_upload") }),
]);
export type PeriodSource = z.infer<typeof PeriodSourceSchema>;

export const CompanySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), company: CompanyCodeSchema }),
  /** A column whose values map to companies (e.g. "MB AB" -> MBAB). */
  z.object({
    kind: z.literal("column"),
    column: col,
    mapping: z.record(z.string(), CompanyCodeSchema),
  }),
  /** Chosen/confirmed per upload (suggested from filename, org.nr, meta lines). */
  z.object({ kind: z.literal("per_upload") }),
]);
export type CompanySource = z.infer<typeof CompanySourceSchema>;

export const CasesConfigSchema = z.object({
  /** Optional entity id (GEN-nummer, anställnings-id). Used for de-duplication only; never stored. */
  keyColumn: col.optional(),
  startColumn: col,
  endColumn: col.optional(),
  /** Column that marks an interruption (non-empty/truthy = interrupted), optionally with a date column. */
  interruptColumn: col.optional(),
  interruptDateColumn: col.optional(),
  resultColumn: col.optional(),
  /** Raw result value (normalized) -> resultattyp label, e.g. { "arbete": "Arbete", "studier": "Studier" }. */
  resultMap: z.record(z.string(), z.string()).default({}),
  resultDateColumn: col.optional(),
  /** Dimension columns to group counts by (e.g. verksamhet, ort). */
  groupBy: z.array(col).default([]),
  /** Metric keys to produce. Omit a key to skip that measure. */
  metrics: z.object({
    active: MetricKeySchema.optional(),
    started: MetricKeySchema.optional(),
    ended: MetricKeySchema.optional(),
    interrupted: MetricKeySchema.optional(),
    results: MetricKeySchema.optional(),
    /**
     * Sum of the tenure in months of the cases active at month end (a snapshot that adds
     * up over groups). Average tenure is a formula: tenure sum ÷ active.
     */
    tenureMonthsSum: MetricKeySchema.optional(),
    /**
     * @deprecated Average tenure per group, which cannot be added up over groups or
     * companies. Kept only so configs saved before tenureMonthsSum still parse; ingest
     * ignores it with a warning. Use tenureMonthsSum.
     */
    tenureMonths: MetricKeySchema.optional(),
  }),
  /** First month to produce (defaults to the earliest start in the file). */
  fromMonth: MonthSchema.optional(),
});
export type CasesConfig = z.infer<typeof CasesConfigSchema>;

/**
 * How a budget file writes its amounts. budget_belopp is always stored in bookkeeping
 * (SIE) sign like ledger amounts: revenue negative, costs positive.
 * - result: revenue positive, costs negative (a result budget) -> multiplied by -1
 * - positive: every amount positive -> multiplied by the kontogrupp's account-group sign
 * - ledger: already in SIE sign -> unchanged (also when the field is left out)
 */
export const BudgetSignSchema = z.enum(["result", "positive", "ledger"]);
export type BudgetSign = z.infer<typeof BudgetSignSchema>;

/** Swedish UI labels for BudgetSign. */
export const BUDGET_SIGN_LABELS: Record<BudgetSign, string> = {
  result: "Intäkter plus, kostnader minus",
  positive: "Alla belopp positiva",
  ledger: "Som i bokföringen (intäkter minus, kostnader plus)",
};

/** A sheet row index (0-based), as RawSheet.rows and DetectedTable.headerRows count them. */
export const HeaderRowSchema = z.number().int().nonnegative();

export const TableTemplateConfigSchema = z.object({
  kind: z.literal("table"),
  steps: z.array(StepSchema).default([]),
  columns: z.array(ColumnMappingSchema),
  counters: z.array(CounterSchema).default([]),
  period: PeriodSourceSchema,
  company: CompanySourceSchema,
  scenario: ScenarioSchema.default("utfall"),
  /** Sign convention of budget_belopp amounts in the file (see BudgetSignSchema). */
  budgetSign: BudgetSignSchema.optional(),
  /** 0-based sheet row of the (last) header row, picked by hand; omitted = detected. */
  headerRow: HeaderRowSchema.optional(),
});

export const CasesTemplateConfigSchema = z.object({
  kind: z.literal("cases"),
  steps: z.array(StepSchema).default([]),
  columns: z.array(ColumnMappingSchema),
  cases: CasesConfigSchema,
  company: CompanySourceSchema,
  /** 0-based sheet row of the (last) header row, picked by hand; omitted = detected. */
  headerRow: HeaderRowSchema.optional(),
});

export const SieTemplateConfigSchema = z.object({
  kind: z.literal("sie"),
  /** SIE dimension numbers to keep as object breakdowns (1 = kostnadsställe, 6 = projekt). */
  objectDims: z.array(z.number().int().positive()).default([1]),
});

export const TemplateConfigSchema = z.discriminatedUnion("kind", [
  TableTemplateConfigSchema,
  CasesTemplateConfigSchema,
  SieTemplateConfigSchema,
]);
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;
export type TableTemplateConfig = z.infer<typeof TableTemplateConfigSchema>;
export type CasesTemplateConfig = z.infer<typeof CasesTemplateConfigSchema>;
export type SieTemplateConfig = z.infer<typeof SieTemplateConfigSchema>;

export const ImportTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  datasetKey: DatasetKeySchema,
  name: z.string().min(1),
  /** Normalized headers in source order; used for recognition and drift detection. */
  headerSignature: z.array(z.string()),
  /** Sheet name hint for multi-sheet workbooks. */
  sheetHint: z.string().optional(),
  version: z.number().int().positive().default(1),
  config: TemplateConfigSchema,
});
export type ImportTemplate = z.infer<typeof ImportTemplateSchema>;

/** Result of comparing a file's headers with a template's signature. */
export interface SignatureDiff {
  added: string[];
  removed: string[];
  /** Likely renames (removed ~ added by similarity), for the "what changed" view. */
  renamed: { from: string; to: string; similarity: number }[];
  reordered: boolean;
  /** True when nothing material changed (order changes alone are fine). */
  compatible: boolean;
}

/** Per-upload choices confirmed by the user when the template defers them. */
export const UploadChoicesSchema = z.object({
  month: MonthSchema.optional(),
  company: CompanyCodeSchema.optional(),
  /** Export date of a cases file (no months after this are produced). */
  asOfDate: IsoDateSchema.optional(),
});
export type UploadChoices = z.infer<typeof UploadChoicesSchema>;
