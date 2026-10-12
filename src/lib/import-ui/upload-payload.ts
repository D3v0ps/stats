// What staging sends to the server: the upload header, then facts or ledger
// rows in chunks small enough for one Server Action request each.
import type {
  FactRow,
  IngestResult,
  LedgerAccount,
  LedgerObject,
  LedgerRow,
  ParseReport,
  UploadCreate,
} from "@/lib/contracts";
import { formatNumber } from "@/lib/core/format-sv";
import { chunkBySize } from "./chunking";

export interface TemplateUse {
  id: string;
  version: number;
}

/** Skipped rows and issues kept in the stored parse report (the review shows them all). */
export const REPORT_MAX_SKIPPED = 2000;
export const REPORT_MAX_ISSUES = 1000;
const REPORT_MAX_WARNINGS = 100;

/**
 * The parse report as it is sent with the upload header. The server drops cell
 * values and skip details anyway (they can be personal data), so they never
 * leave the browser; long lists are cut so a 50 000-row file with many filtered
 * rows still fits in one Server Action request (1 MB), with a note on the cut.
 */
export function compactParseReport(report: ParseReport): ParseReport {
  const skipped = report.skipped
    .slice(0, REPORT_MAX_SKIPPED)
    .map(({ sourceRow, reason }) => ({ sourceRow, reason }));
  const issues = report.issues
    .slice(0, REPORT_MAX_ISSUES)
    .map(({ sourceRow, column, message, severity }) => ({
      sourceRow,
      column,
      value: "",
      message,
      severity,
    }));
  const warnings = report.warnings.slice(0, REPORT_MAX_WARNINGS);
  const cut: string[] = [];
  if (report.skipped.length > skipped.length)
    cut.push(`${formatNumber(report.skipped.length)} rader som inte räknades`);
  if (report.issues.length > issues.length)
    cut.push(`${formatNumber(report.issues.length)} celler som inte kunde läsas`);
  if (cut.length > 0) {
    warnings.push(`Rapporten sparar de första exemplen av ${cut.join(" och ")}.`);
  }
  return { ...report, skipped, issues, warnings };
}

/** The staged upload header for a result (null template for SIE files). */
export function buildUploadCreate(
  result: IngestResult,
  template: TemplateUse | null,
): UploadCreate {
  return {
    datasetKey: result.datasetKey,
    templateId: template?.id ?? null,
    templateVersion: template?.version ?? null,
    scenario: result.scenario,
    fileName: result.file.name,
    fileSha256: result.file.sha256,
    fileSize: result.file.size,
    contentHash: result.contentHash,
    engineVersion: result.engineVersion,
    asOfDate: result.asOfDate ?? null,
    slices: result.slices.map((s) => ({
      company: s.company,
      month: s.month,
      priority: s.priority ?? 0,
    })),
    parseReport: compactParseReport(result.report),
    totals: result.totals,
  };
}

export interface LedgerChunk {
  rows: LedgerRow[];
  accounts: LedgerAccount[];
  objects: LedgerObject[];
}

/** Fact chunks for stageFacts. */
export function factChunks(rows: readonly FactRow[]): FactRow[][] {
  return chunkBySize(rows);
}

/**
 * Ledger chunks for stageLedger. Account names and object names travel with the
 * first chunk; every chunk's object codes are created on the server as needed.
 */
export function ledgerChunks(ledger: NonNullable<IngestResult["ledger"]>): LedgerChunk[] {
  const parts = chunkBySize(ledger.rows);
  if (parts.length === 0) {
    return ledger.accounts.length || ledger.objects.length
      ? [{ rows: [], accounts: ledger.accounts, objects: ledger.objects }]
      : [];
  }
  return parts.map((rows, i) => ({
    rows,
    accounts: i === 0 ? ledger.accounts : [],
    objects: i === 0 ? ledger.objects : [],
  }));
}

/** Rows to stage in total (for the progress bar). */
export function stageTotal(result: IngestResult, facts: readonly FactRow[] | null): number {
  return result.ledger ? result.ledger.rows.length : (facts?.length ?? 0);
}
