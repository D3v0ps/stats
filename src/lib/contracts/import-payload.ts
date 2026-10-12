// What ingest produces (in the browser) and what gets staged into the database.
// Only aggregated facts and source row numbers ever leave the browser.
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
import type { ParseIssue, SkippedRow } from "./workbook";

/** A fact before dimension labels are resolved to ids. */
export const FactDraftSchema = z.object({
  metricKey: MetricKeySchema,
  company: CompanyCodeSchema,
  month: MonthSchema,
  /** dimensionKey -> canonical label (after lookup/aliases). Every mapped dimension is present. */
  dims: z.record(DimensionKeySchema, z.string()),
  value: z.number().finite(),
  /** 1-based source rows that contributed (empty for cases templates). */
  sourceRows: z.array(z.number().int().positive()),
});
export type FactDraft = z.infer<typeof FactDraftSchema>;

/** A fact ready for the database: dims hold dimension_values.id. */
export const FactRowSchema = FactDraftSchema.extend({
  dims: z.record(DimensionKeySchema, z.number().int().positive()),
});
export type FactRow = z.infer<typeof FactRowSchema>;

/** One SIE ledger balance: account x month (x optional object). */
export const LedgerRowSchema = z.object({
  company: CompanyCodeSchema,
  month: MonthSchema,
  account: z.number().int().min(1000).max(9999),
  /** null = account total; otherwise the SIE dimension number of the object. */
  dimNo: z.number().int().positive().nullable(),
  /** Object code within dimNo (e.g. "100"). null when dimNo is null. */
  objectCode: z.string().nullable(),
  /** Signed as in SIE: revenue negative (credit), costs positive (debit). */
  amount: z.number().finite(),
  /** 0 = the file's current year, -1 = previous year rows inside the same file. */
  yearOffset: z.number().int().max(0),
  source: z.enum(["psaldo", "trans"]),
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export interface LedgerAccount {
  company: z.infer<typeof CompanyCodeSchema>;
  account: number;
  name: string;
}

export interface LedgerObject {
  company: z.infer<typeof CompanyCodeSchema>;
  dimNo: number;
  code: string;
  name: string;
}

export interface SieChecks {
  orgNr: string | null;
  companyName: string | null;
  /** Company resolved from #ORGNR; null if unknown (publish is blocked). */
  company: z.infer<typeof CompanyCodeSchema> | null;
  encoding: "cp437" | "windows-1252" | "utf-8";
  /** #FORMAT value as written in the file. */
  declaredFormat: string | null;
  fiscalYears: { yearNo: number; start: string; end: string }[];
  /** Result (= −Σ accounts 3000–8999) per month of the current fiscal year. */
  resultPerMonth: { month: string; result: number }[];
  resultYtd: number;
  /** Σ12 months of #PSALDO per account vs #RES 0. */
  resCheck: { ok: boolean; mismatches: { account: number; psaldoSum: number; res: number }[] };
  usedTransFallback: boolean;
  warnings: string[];
}

export interface ParseReport {
  rowsRead: number;
  rowsUsed: number;
  skipped: SkippedRow[];
  issues: ParseIssue[];
  warnings: string[];
  sheet?: string;
  headerRow?: number;
  encoding?: string;
  delimiter?: string;
}

export interface MetricTotal {
  metricKey: string;
  company: z.infer<typeof CompanyCodeSchema>;
  month: string;
  value: number;
}

/** Everything ingest hands to the review/publish step for one file. */
export interface IngestResult {
  engineVersion: number;
  datasetKey: string;
  scenario: z.infer<typeof ScenarioSchema>;
  file: { name: string; sha256: string; size: number };
  /** Hash of the normalized facts; equal hashes mean "no change vs current data". */
  contentHash: string;
  asOfDate?: string;
  companies: z.infer<typeof CompanyCodeSchema>[];
  /**
   * Covered months per company. priority < 0 marks lower-precedence data (e.g. previous-year
   * rows inside a SIE file); a slice's own file (priority 0) always wins over them.
   */
  slices: { company: z.infer<typeof CompanyCodeSchema>; month: string; priority?: number }[];
  facts: FactDraft[];
  ledger?: {
    rows: LedgerRow[];
    accounts: LedgerAccount[];
    objects: LedgerObject[];
    checks: SieChecks;
  };
  report: ParseReport;
  totals: MetricTotal[];
}

/** Upload header row written before staging facts. */
export const UploadCreateSchema = z.object({
  datasetKey: DatasetKeySchema,
  templateId: z.string().uuid().nullable(),
  templateVersion: z.number().int().positive().nullable(),
  scenario: ScenarioSchema,
  fileName: z.string().min(1),
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  fileSize: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  engineVersion: z.number().int().positive(),
  asOfDate: IsoDateSchema.nullable(),
  slices: z
    .array(
      z.object({
        company: CompanyCodeSchema,
        month: MonthSchema,
        priority: z.number().int().max(0).default(0),
      }),
    )
    .min(1),
  parseReport: z.unknown(),
  totals: z.unknown(),
});
export type UploadCreate = z.infer<typeof UploadCreateSchema>;
