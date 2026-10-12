// Shared domain vocabulary. Every module (ingest, SIE, metrics, DB, UI) speaks
// these types. Changing anything here is a cross-module change: update all users.
import { z } from "zod";

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
export type MonthString = z.infer<typeof MonthSchema>;

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Company codes. MBAB = Miljonbemanning AB, MBR = Miljonbemanning Restart AB. */
export const CompanyCodeSchema = z.enum(["MBAB", "MBR"]);
export type CompanyCode = z.infer<typeof CompanyCodeSchema>;

/** Company filter in queries/UI. ALL = "Summa bolag" (not eliminated). */
export const CompanyFilterSchema = z.enum(["MBAB", "MBR", "ALL"]);
export type CompanyFilter = z.infer<typeof CompanyFilterSchema>;

export const COMPANIES: Record<
  CompanyCode,
  { legalName: string; shortName: string; orgNr: string }
> = {
  MBAB: { legalName: "Miljonbemanning AB", shortName: "MB AB", orgNr: "556959-9318" },
  MBR: { legalName: "Miljonbemanning Restart AB", shortName: "MB Restart", orgNr: "559208-9071" },
};

export const COMPANY_FILTER_LABELS: Record<CompanyFilter, string> = {
  MBAB: "MB AB",
  MBR: "MB Restart",
  ALL: "Summa bolag",
};

export const ScenarioSchema = z.enum(["utfall", "budget"]);
export type Scenario = z.infer<typeof ScenarioSchema>;

/** man = månader (tenure). */
export const UnitSchema = z.enum(["st", "kr", "h", "pct", "faktor", "man"]);
export type Unit = z.infer<typeof UnitSchema>;

/**
 * How a metric rolls up over time and groups:
 * - sum: additive over months and groups (hours, amounts, started, ended)
 * - snapshot: a state at month end (active participants). NEVER summed over
 *   months; multi-month windows use the last month (or average, see rollup).
 *   Summing over groups/companies within one month is fine.
 * - distinct: count of distinct values of `distinctDimension` among the facts of
 *   `baseMetric` with value > 0 (consultants who worked). Counted over the
 *   whole window and group, never by adding monthly counts.
 * - ledger: SIE ledger balances summed over the account ranges of an account group, times its sign
 * - formula: expression over other metric keys, evaluated after each operand
 *   has been rolled up by its own rule (ratio of sums, never sum of ratios)
 */
export const MetricKindSchema = z.enum(["sum", "snapshot", "distinct", "ledger", "formula"]);
export type MetricKind = z.infer<typeof MetricKindSchema>;

export const SnapshotRollupSchema = z.enum(["last", "avg"]);
export type SnapshotRollup = z.infer<typeof SnapshotRollupSchema>;

/** Seeded dataset keys. More can be added in settings (they are data, not code). */
export const SEEDED_DATASETS = {
  ip_timmar: "Intelliplan – timmar och pass",
  ip_franvaro: "Intelliplan – frånvaro",
  ip_fakturering: "Intelliplan – fakturerat och lön",
  ip_konsulter: "Intelliplan – konsultlista",
  wb_deltagare: "Workbuster – deltagare",
  wb_ordrar: "Workbuster – ordrar",
  fx_bokforing: "Fortnox – bokföring (SIE4)",
  fx_kundforsaljning: "Fortnox – försäljning per kund",
  budget: "Budget",
} as const;
export type SeededDatasetKey = keyof typeof SEEDED_DATASETS;

export const DatasetKindSchema = z.enum(["table", "cases", "ledger"]);
export type DatasetKind = z.infer<typeof DatasetKindSchema>;

/** Seeded dimension keys. `konsult` is personal data (never in board output). */
export const SEEDED_DIMENSIONS = {
  verksamhet: { label: "Verksamhet", personal: false },
  kund: { label: "Kund", personal: false },
  uppdrag: { label: "Uppdrag", personal: false },
  kostnadsstalle: { label: "Kostnadsställe", personal: false },
  ort: { label: "Ort", personal: false },
  konsult: { label: "Konsult", personal: true },
  franvarotyp: { label: "Frånvarotyp", personal: false },
  resultattyp: { label: "Resultat", personal: false },
  ordertyp: { label: "Ordertyp", personal: false },
  kontogrupp: { label: "Kontogrupp", personal: false },
} as const;
export type SeededDimensionKey = keyof typeof SEEDED_DIMENSIONS;

/** Seeded values of the `verksamhet` dimension (editable later in settings). */
export const SEEDED_VERKSAMHETER = [
  "ROM2",
  "KROM",
  "KVL",
  "Karriärvägledning",
  "Stöd och matchning",
  "Bemanning",
] as const;

export const DimensionKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export const MetricKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,60}$/);
export const DatasetKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);

export const ComparisonKindSchema = z.enum(["prev_period", "prev_year", "budget"]);
export type ComparisonKind = z.infer<typeof ComparisonKindSchema>;

export const PeriodGrainSchema = z.enum(["month", "quarter", "year", "ytd", "r12"]);
export const PeriodSelectionSchema = z.object({
  grain: PeriodGrainSchema,
  anchor: MonthSchema,
});
export type PeriodSelectionInput = z.infer<typeof PeriodSelectionSchema>;

/** Bumped whenever aggregation semantics in ingest change. Publish rejects older payloads. */
export const ENGINE_VERSION = 1;
