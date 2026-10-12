// What staging sends to the server: the upload header, then facts or ledger
// rows in chunks small enough for one Server Action request each.
import type {
  FactRow,
  IngestResult,
  LedgerAccount,
  LedgerObject,
  LedgerRow,
  UploadCreate,
} from "@/lib/contracts";
import { chunkBySize } from "./chunking";

export interface TemplateUse {
  id: string;
  version: number;
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
    parseReport: result.report,
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
