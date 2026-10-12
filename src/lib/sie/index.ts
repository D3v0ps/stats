// SIE4 ingest: bytes of one Fortnox export -> IngestResult with ledger rows,
// accounts, objects, review checks, slices and monthly result totals.
import {
  ENGINE_VERSION,
  type CompanyCode,
  type IngestResult,
  type LedgerAccount,
  type LedgerObject,
  type LedgerRow,
  type MetricTotal,
  type ParseIssue,
} from "@/lib/contracts";
import { buildChecks, resolveCompany } from "./checks";
import { decodeSie } from "./decode";
import { fromOre, isResultAccount, toLedger, toOre } from "./ledger";
import { parseSie, type SieFile } from "./parse";
import { containsPersonnummer, maskPersonnummer } from "./pii";
import { sha256Hex } from "./sha256";

export { buildChecks, normalizeOrgNr, resolveCompany } from "./checks";
export { decodeSie, type DecodedSie, type SieEncoding } from "./decode";
export {
  countsInBalance,
  detectPsaldoMode,
  isResultAccount,
  toLedger,
  type LedgerDiagnostics,
  type LedgerOptions,
  type LedgerResult,
  type PsaldoMode,
} from "./ledger";
export { containsPersonnummer, isPersonalDimension, maskPersonnummer } from "./pii";
export {
  parseSie,
  type SieFile,
  type SieObjectRef,
  type SiePeriodBalance,
  type SieTrans,
  type SieVoucher,
} from "./parse";
export { tokenizeSie, type SieField, type SieLine } from "./tokenize";

export const SIE_DATASET_KEY = "fx_bokforing";
/** Metric whose monthly value is reported in IngestResult.totals. */
export const SIE_TOTAL_METRIC = "resultat";

export interface IngestSieOptions {
  /**
   * SIE dimensions kept as object rows (template setting; default [1] = kostnadsställe).
   * Personal dimensions (7 = Anställd, or named like one) are always left out.
   */
  objectDims?: number[];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Order-independent, formatting-independent serialization of the ledger rows. */
export function canonicalLedger(rows: LedgerRow[]): string {
  const tuples = rows.map((r) => [
    r.company,
    r.month,
    r.account,
    r.dimNo,
    r.objectCode,
    toOre(r.amount),
    r.yearOffset,
    r.source,
  ]);
  const keys = tuples.map((t) => JSON.stringify(t));
  return `[${keys.sort(cmp).join(",")}]`;
}

function ledgerAccounts(sie: SieFile, company: CompanyCode): LedgerAccount[] {
  return Object.entries(sie.konto)
    .map(([account, name]) => ({ company, account: Number(account), name: maskPersonnummer(name) }))
    .filter((a) => isResultAccount(a.account))
    .sort((a, b) => a.account - b.account);
}

function ledgerObjects(
  sie: SieFile,
  company: CompanyCode,
  objectDims: number[],
  rows: LedgerRow[],
): LedgerObject[] {
  const out = new Map<string, LedgerObject>();
  for (const dimNo of objectDims) {
    for (const [code, name] of Object.entries(sie.objekt[dimNo] ?? {})) {
      // Same rule as the rows: blank codes and personnummer never become objects.
      if (code.trim() === "" || containsPersonnummer(code)) continue;
      out.set(`${dimNo}|${code}`, { company, dimNo, code, name: maskPersonnummer(name) });
    }
  }
  // Objects used in rows but never declared still need a value to map to.
  for (const r of rows) {
    if (r.dimNo === null || r.objectCode === null) continue;
    const key = `${r.dimNo}|${r.objectCode}`;
    if (!out.has(key))
      out.set(key, { company, dimNo: r.dimNo, code: r.objectCode, name: r.objectCode });
  }
  return [...out.values()].sort((a, b) => a.dimNo - b.dimNo || cmp(a.code, b.code));
}

export async function ingestSie(
  bytes: Uint8Array,
  fileName: string,
  opts: IngestSieOptions = {},
): Promise<IngestResult> {
  const decoded = decodeSie(bytes);
  const sie = parseSie(decoded.text);
  const company = resolveCompany(sie.orgnr);
  // Rows carry a company code. For an unknown org number the checks are still
  // computed (with a provisional tag) but no rows, slices or totals are returned,
  // so nothing can be staged under the wrong company.
  const ledger = toLedger(sie, company ?? "MBAB", { objectDims: opts.objectDims ?? [1] });
  const checks = buildChecks({ sie, decoded, ledger });
  const rows = company ? ledger.rows : [];

  const slicePriority = new Map<
    string,
    { company: CompanyCode; month: string; priority: number }
  >();
  const resultOre = new Map<string, { company: CompanyCode; month: string; ore: number }>();
  for (const r of rows) {
    const key = `${r.company}|${r.month}`;
    const priority = r.yearOffset === 0 ? 0 : -1;
    const slice = slicePriority.get(key);
    if (!slice) slicePriority.set(key, { company: r.company, month: r.month, priority });
    else slice.priority = Math.max(slice.priority, priority);
    if (r.dimNo === null) {
      const t = resultOre.get(key) ?? { company: r.company, month: r.month, ore: 0 };
      t.ore -= toOre(r.amount);
      resultOre.set(key, t);
    }
  }
  const slices = [...slicePriority.values()].sort((a, b) => cmp(a.month, b.month));
  const totals: MetricTotal[] = [...resultOre.values()]
    .sort((a, b) => cmp(a.month, b.month))
    .map((t) => ({
      metricKey: SIE_TOTAL_METRIC,
      company: t.company,
      month: t.month,
      value: fromOre(t.ore),
    }));

  // Issue values quote the file; the report is stored with the upload.
  const issues: ParseIssue[] = sie.issues.map((i) => ({
    sourceRow: i.lineNo,
    column: i.label,
    value: maskPersonnummer(i.value ?? ""),
    message: i.message,
    severity: "warning",
  }));
  const unknownLines = Object.values(sie.unknownLabels).reduce((a, n) => a + n, 0);
  // Record lines with a problem (issues on braces or unlabeled lines are not records).
  const issueLines = new Set(
    sie.issues.filter((i) => i.label.startsWith("#")).map((i) => i.lineNo),
  );
  const rowsUsed = Math.max(0, sie.recordCount - unknownLines - issueLines.size);

  const [fileSha, contentHash] = await Promise.all([
    sha256Hex(bytes),
    sha256Hex(canonicalLedger(rows)),
  ]);

  const result: IngestResult = {
    engineVersion: ENGINE_VERSION,
    datasetKey: SIE_DATASET_KEY,
    scenario: "utfall",
    // The name is stored with the upload; people name files after people.
    file: { name: maskPersonnummer(fileName), sha256: fileSha, size: bytes.byteLength },
    contentHash,
    companies: company ? [company] : [],
    slices,
    facts: [],
    ledger: {
      rows,
      accounts: company ? ledgerAccounts(sie, company) : [],
      objects: company ? ledgerObjects(sie, company, ledger.diagnostics.objectDims, rows) : [],
      checks,
    },
    report: {
      rowsRead: sie.recordCount,
      rowsUsed,
      skipped: [],
      issues,
      warnings: checks.warnings,
      encoding: decoded.encoding,
    },
    totals,
  };
  if (sie.gen) result.asOfDate = sie.gen.date;
  return result;
}
