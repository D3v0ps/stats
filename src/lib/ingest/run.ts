// End-to-end ingest of one file with a saved template: sheet -> table ->
// steps -> facts -> IngestResult for review and staging.
import {
  ENGINE_VERSION,
  type CompanyCode,
  type DetectedTable,
  type FactDraft,
  type ImportTemplate,
  type IngestResult,
  type MetricTotal,
  type ParseIssue,
  type ParseReport,
  type RawSheet,
  type RawWorkbook,
  type SkippedRow,
  type UploadChoices,
} from "@/lib/contracts";
import { canonicalJson, sha256Hex } from "@/lib/core/hash";
import { redactPersonnummer } from "@/lib/core/pnr";
import { aggregateTable, roundSum } from "./aggregate";
import { buildCases } from "./cases";
import { detectTable, detectTableWithHeaderRow, pickSheet } from "./header-detect";
import { applySteps, type AliasTables } from "./pipeline";
import { diffSignature, headerSignature } from "./recognize";
import { fromDetected, type WorkingTable } from "./working";

/** The file can't be ingested with this template (no sheet, missing choice, wrong kind). */
export class IngestError extends Error {
  override name = "IngestError";
}

export interface RunContext {
  aliases: AliasTables;
  fileSha256: string;
  fileSize: number;
  /**
   * 0-based header row picked by the user for this upload. Overrides the template's own
   * headerRow, which in turn overrides detection.
   */
  headerRow?: number;
  /**
   * Account group key -> sign (revenue -1), from the account groups in settings. Budget
   * templates with budgetSign "positive" need it to store budget_belopp in SIE sign.
   */
  accountGroupSigns?: Record<string, 1 | -1>;
  /** Account group key -> name, so kontogrupp labels may name the group instead of its key. */
  accountGroupNames?: Record<string, string>;
}

export interface LoadOptions {
  sheetHint?: string;
  expectedHeaders?: string[];
  headerRow?: number;
}

export interface LoadedTable {
  sheet: RawSheet;
  table: DetectedTable;
  working: WorkingTable;
}

/** Pick the sheet, detect the table and build the working table (shared with the mapping UI). */
export function loadTable(workbook: RawWorkbook, opts: LoadOptions = {}): LoadedTable {
  const sheet = pickSheet(workbook, opts.sheetHint);
  if (!sheet) throw new IngestError("Filen innehåller inget kalkylblad.");
  const table =
    opts.headerRow !== undefined
      ? detectTableWithHeaderRow(sheet, opts.headerRow)
      : detectTable(sheet, { expectedHeaders: opts.expectedHeaders });
  return { sheet, table, working: fromDetected(table, { date1904: workbook.date1904 }) };
}

const COMPANY_ORDER: CompanyCode[] = ["MBAB", "MBR"];

function sumTotals(facts: FactDraft[]): MetricTotal[] {
  const map = new Map<string, MetricTotal>();
  for (const f of facts) {
    const key = `${f.metricKey}\u0000${f.company}\u0000${f.month}`;
    const t = map.get(key) ?? {
      metricKey: f.metricKey,
      company: f.company,
      month: f.month,
      value: 0,
    };
    t.value += f.value;
    map.set(key, t);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, t]) => ({ ...t, value: roundSum(t.value) }));
}

/**
 * Hash of the facts without source rows: re-sorting the file or adding rows
 * that don't change any number gives the same hash ("no change").
 */
export async function factsContentHash(facts: FactDraft[]): Promise<string> {
  const normalized = facts.map((f) => ({
    metricKey: f.metricKey,
    company: f.company,
    month: f.month,
    dims: f.dims,
    value: f.value,
  }));
  const sorted = normalized
    .map((f) => [canonicalJson(f), f] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, f]) => f);
  return sha256Hex(canonicalJson(sorted));
}

function sortSkipped(list: SkippedRow[]): SkippedRow[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.sourceRow - b.s.sourceRow || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * The report and file name are stored with the upload. Issue values and skip
 * details quote cells, which can come from any column (also removed ones that
 * a step touched), so personnummer are masked here as a last line of defence.
 */
function redactReport(report: ParseReport): ParseReport {
  const r = redactPersonnummer;
  return {
    ...report,
    skipped: report.skipped.map((s) =>
      s.detail === undefined ? s : { ...s, detail: r(s.detail) },
    ),
    issues: report.issues.map((i) => ({
      ...i,
      column: r(i.column),
      value: r(i.value),
      message: r(i.message),
    })),
    warnings: report.warnings.map(r),
    ...(report.sheet !== undefined ? { sheet: r(report.sheet) } : {}),
  };
}

function listPreview(values: string[], max = 10): string {
  const head = values.slice(0, max).join(", ");
  return values.length > max ? `${head} … (+${values.length - max})` : head;
}

/**
 * Run a table or cases template on a workbook. SIE templates belong to the SIE
 * module and throw. Throws IngestError when the file can't be processed at
 * all; row-level problems are reported in the result.
 */
export async function runTemplate(
  workbook: RawWorkbook,
  template: ImportTemplate,
  choices: UploadChoices,
  ctx: RunContext,
): Promise<IngestResult> {
  const config = template.config;
  if (config.kind === "sie") {
    throw new IngestError("SIE-filer läses av SIE-modulen, inte av tabellimporten.");
  }
  if (config.kind === "cases" && !choices.asOfDate) {
    throw new IngestError("Exportdatum saknas för filen.");
  }

  const pickedHeaderRow = ctx.headerRow ?? config.headerRow;
  const { table, working } = loadTable(workbook, {
    sheetHint: template.sheetHint,
    expectedHeaders: template.headerSignature,
    headerRow: pickedHeaderRow,
  });
  const stepped = applySteps(working, config.steps ?? [], { aliases: ctx.aliases });

  let facts: FactDraft[];
  let issues: ParseIssue[];
  let skipped: SkippedRow[];
  let rowsUsed: number;
  let totals: MetricTotal[];
  let scenario: IngestResult["scenario"];
  if (config.kind === "table") {
    const r = aggregateTable(stepped.table, config, choices, {
      accountGroupSigns: ctx.accountGroupSigns,
      accountGroupNames: ctx.accountGroupNames,
    });
    ({ facts, issues, skipped, rowsUsed } = r);
    totals = sumTotals(facts);
    scenario = config.scenario ?? "utfall";
  } else {
    const r = buildCases(stepped.table, config, {
      company: choices.company,
      asOfDate: choices.asOfDate!,
    });
    ({ facts, issues, skipped, rowsUsed, totals } = r);
    scenario = "utfall";
  }

  const warnings: string[] = [];
  const headerRow = table.headerRows.length
    ? table.headerRows[table.headerRows.length - 1]! + 1
    : undefined;
  if (pickedHeaderRow === undefined && table.confidence < 0.5) {
    warnings.push(
      `Rubrikraden hittades med låg säkerhet${headerRow ? ` (rad ${headerRow})` : ""}. Kontrollera att rätt rad används.`,
    );
  }
  if (template.headerSignature.length > 0) {
    const diff = diffSignature(template.headerSignature, headerSignature(table));
    if (!diff.compatible) {
      const parts = [
        diff.added.length ? `nya: ${listPreview(diff.added)}` : "",
        diff.removed.length ? `saknas: ${listPreview(diff.removed)}` : "",
        diff.renamed.length
          ? `bytt namn: ${listPreview(diff.renamed.map((r) => `${r.from} → ${r.to}`))}`
          : "",
      ].filter(Boolean);
      warnings.push(`Kolumnerna skiljer sig från mallen (${parts.join("; ")}).`);
    }
  }
  for (const [dim, values] of Object.entries(stepped.unknownLookups)) {
    warnings.push(`Okända värden för ${dim}: ${listPreview(values)}.`);
  }
  if (facts.length === 0) warnings.push("Inga värden kunde läsas från filen.");

  const companies = COMPANY_ORDER.filter((c) => facts.some((f) => f.company === c));
  const sliceKeys = new Set(facts.map((f) => `${f.company}\u0000${f.month}`));
  const slices = [...sliceKeys]
    .map((k) => {
      const [company, month] = k.split("\u0000") as [CompanyCode, string];
      return { company, month };
    })
    .sort(
      (a, b) =>
        COMPANY_ORDER.indexOf(a.company) - COMPANY_ORDER.indexOf(b.company) ||
        (a.month < b.month ? -1 : a.month > b.month ? 1 : 0),
    );

  const result: IngestResult = {
    engineVersion: ENGINE_VERSION,
    datasetKey: template.datasetKey,
    scenario,
    file: {
      name: redactPersonnummer(workbook.fileName),
      sha256: ctx.fileSha256,
      size: ctx.fileSize,
    },
    contentHash: await factsContentHash(facts),
    companies,
    slices,
    facts,
    report: redactReport({
      rowsRead: table.rows.length + table.skipped.filter((s) => s.reason !== "empty").length,
      rowsUsed,
      skipped: sortSkipped([...table.skipped, ...stepped.skipped, ...skipped]),
      issues: [...stepped.issues, ...issues],
      warnings,
      sheet: table.sheetName,
      ...(headerRow !== undefined ? { headerRow } : {}),
      ...(workbook.encoding ? { encoding: workbook.encoding } : {}),
      ...(workbook.delimiter ? { delimiter: workbook.delimiter } : {}),
    }),
    totals,
  };
  if (config.kind === "cases") result.asOfDate = choices.asOfDate;
  return result;
}
