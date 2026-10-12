// The parsing side of the upload flow, shared by the Web Worker
// (src/workers/ingest.worker.ts) and the main-thread fallback. It keeps each
// file in memory under a file id and answers typed requests by calling the
// ingest and SIE libraries; no parsing logic lives here. The original file
// never leaves this service: responses carry summaries, previews (after the
// removed columns are dropped) and aggregated results only.
import type {
  ColumnMapping,
  ColumnType,
  FileFormat,
  ImportTemplate,
  IngestResult,
  ParseIssue,
  RawWorkbook,
  Step,
  UploadChoices,
} from "@/lib/contracts";
import { sha256Hex } from "@/lib/core/hash";
import { redactPersonnummer } from "@/lib/core/pnr";
import {
  IngestError,
  PersonalDataError,
  ReadError,
  applySteps,
  columnValues,
  headerSignature,
  inferColumnType,
  isLockedRemoved,
  loadTable,
  pickSheet,
  readWorkbook,
  runTemplate,
  suggestCompany,
  suggestMappings,
  suggestPeriod,
  type AliasTables,
  type CompanySuggestion,
  type LoadedTable,
  type PeriodSuggestion,
} from "@/lib/ingest";
import { ingestSie } from "@/lib/sie";
import type { SourceColumnInfo } from "./mapping";
import { suggestAsOfDate } from "./months";
import {
  displayValue,
  distinctRawValues,
  distinctValues,
  measureSums,
  type MeasureSum,
} from "./preview";

// ---- Protocol -------------------------------------------------------------------

export type IngestRequest =
  | { op: "read"; fileId: string; fileName: string; bytes: ArrayBuffer | Uint8Array }
  | { op: "recognize"; fileId: string; hints: string[]; today: string }
  | {
      op: "inspect";
      fileId: string;
      sheetHint?: string;
      headerRow?: number;
      datasetKey?: string | null;
    }
  | {
      op: "preview";
      fileId: string;
      sheetHint?: string;
      headerRow?: number;
      steps: Step[];
      aliases: AliasTables;
      datasetKey?: string | null;
      measures: { column: string; type: ColumnType }[];
      distinctFor?: string[];
      limit?: number;
    }
  | {
      op: "apply";
      fileId: string;
      template: ImportTemplate;
      choices: UploadChoices;
      aliases: AliasTables;
      headerRow?: number;
    }
  | { op: "release"; fileId: string };

export interface SheetInfo {
  name: string;
  hidden: boolean;
}

export interface ReadResponse {
  ok: true;
  op: "read";
  format: FileFormat;
  sha256: string;
  size: number;
  sheets: SheetInfo[];
  encoding?: string;
  /** SIE files are ingested right away. */
  sie?: IngestResult;
}

export interface SheetSummary {
  sheetName: string;
  signature: string[];
  /** 1-based row of the (last) header row, null when no header was found. */
  headerRow: number | null;
  confidence: number;
  rowCount: number;
  metaLines: string[];
  periodSuggestions: PeriodSuggestion[];
  companySuggestion: CompanySuggestion | null;
  asOfSuggestion: string;
}

export interface RecognizeResponse {
  ok: true;
  op: "recognize";
  defaultSheet: string;
  /** Sheet hint -> the sheet pickSheet chooses for it. */
  sheetForHint: Record<string, string>;
  sheets: Record<string, SheetSummary>;
}

export interface InspectResponse {
  ok: true;
  op: "inspect";
  sheetName: string;
  sheets: SheetInfo[];
  headerRow: number | null;
  confidence: number;
  rowCount: number;
  /** Normalized headers of the table (the template's header signature). */
  signature: string[];
  columns: SourceColumnInfo[];
  /** First-guess mappings for the source columns (for the chosen dataset). */
  suggestions: ColumnMapping[];
}

export interface PreviewRow {
  sourceRow: number;
  values: Record<string, string>;
}

export interface PreviewResponse {
  ok: true;
  op: "preview";
  columns: string[];
  headers: Record<string, string>;
  rows: PreviewRow[];
  rowCount: number;
  sums: Record<string, MeasureSum>;
  samples: Record<string, string[]>;
  inferred: Record<string, ColumnType>;
  suggestions: ColumnMapping[];
  issues: ParseIssue[];
  issueCount: number;
  skippedCount: number;
  unknownLookups: Record<string, string[]>;
  distinct: Record<string, string[]>;
}

export interface ApplyResponse {
  ok: true;
  op: "apply";
  result: IngestResult;
}

export interface ReleaseResponse {
  ok: true;
  op: "release";
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

export type IngestResponse =
  | ReadResponse
  | RecognizeResponse
  | InspectResponse
  | PreviewResponse
  | ApplyResponse
  | ReleaseResponse
  | ErrorResponse;

/** Response type for a request op (errors are always possible). */
export type ResponseFor<R extends IngestRequest> =
  Extract<IngestResponse, { op: R["op"] }> | ErrorResponse;

/** Envelope used on the worker channel. */
export interface WorkerEnvelope {
  id: number;
  req: IngestRequest;
}
export interface WorkerReply {
  id: number;
  res: IngestResponse;
}

// ---- Service -------------------------------------------------------------------------

interface FileEntry {
  fileName: string;
  size: number;
  sha256: string;
  format: FileFormat;
  workbook: RawWorkbook | null;
  tables: Map<string, LoadedTable>;
}

export const FILE_GONE_MESSAGE = "Filen finns inte längre i minnet. Lägg till den igen.";
const GENERIC_ERROR = "Filen kunde inte läsas.";
const SAMPLE_VALUES = 5;
const MAX_PERIOD_VALUES = 5000;

function errorMessage(error: unknown): string {
  if (
    error instanceof ReadError ||
    error instanceof IngestError ||
    error instanceof PersonalDataError
  ) {
    return error.message;
  }
  return GENERIC_ERROR;
}

function toBytes(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export class IngestService {
  private readonly files = new Map<string, FileEntry>();

  async handle(req: IngestRequest): Promise<IngestResponse> {
    try {
      switch (req.op) {
        case "read":
          return await this.read(req);
        case "recognize":
          return this.recognize(req);
        case "inspect":
          return this.inspect(req);
        case "preview":
          return this.preview(req);
        case "apply":
          return await this.apply(req);
        case "release":
          this.files.delete(req.fileId);
          return { ok: true, op: "release" };
      }
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private entry(fileId: string): FileEntry {
    const e = this.files.get(fileId);
    if (!e) throw new IngestError(FILE_GONE_MESSAGE);
    return e;
  }

  private table(
    e: FileEntry,
    sheetHint?: string,
    headerRow?: number,
    expected?: string[],
  ): LoadedTable {
    if (!e.workbook) throw new IngestError("Filen innehåller ingen tabell.");
    const key = `${sheetHint ?? ""}\u0000${headerRow ?? ""}\u0000${expected?.join("\u0001") ?? ""}`;
    let t = e.tables.get(key);
    if (!t) {
      t = loadTable(e.workbook, { sheetHint, headerRow, expectedHeaders: expected });
      e.tables.set(key, t);
    }
    return t;
  }

  private async read(req: Extract<IngestRequest, { op: "read" }>): Promise<ReadResponse> {
    const bytes = toBytes(req.bytes);
    const sha256 = await sha256Hex(bytes);
    const workbook = readWorkbook(bytes, req.fileName);
    const base = { ok: true as const, op: "read" as const, sha256, size: bytes.byteLength };
    if (workbook.format === "sie") {
      const sie = await ingestSie(bytes, req.fileName);
      this.files.set(req.fileId, {
        fileName: req.fileName,
        size: bytes.byteLength,
        sha256,
        format: "sie",
        workbook: null,
        tables: new Map(),
      });
      return { ...base, format: "sie", sheets: [], encoding: sie.report.encoding, sie };
    }
    if (workbook.format === "pdf") return { ...base, format: "pdf", sheets: [] };
    if (workbook.sheets.length === 0) throw new ReadError("Filen innehåller inget kalkylblad.");
    this.files.set(req.fileId, {
      fileName: req.fileName,
      size: bytes.byteLength,
      sha256,
      format: workbook.format,
      workbook,
      tables: new Map(),
    });
    return {
      ...base,
      format: workbook.format,
      sheets: workbook.sheets.map((s) => ({ name: s.name, hidden: s.hidden })),
      ...(workbook.encoding ? { encoding: workbook.encoding } : {}),
    };
  }

  private summary(e: FileEntry, loaded: LoadedTable, today: string): SheetSummary {
    const { table, working } = loaded;
    // A date column (if any) adds evidence for the month.
    let dateValues: unknown[] | undefined;
    for (const c of working.columns) {
      const values = columnValues(working, c);
      if (values.length > 0 && inferColumnType(values.slice(0, 200)).type === "date") {
        dateValues = values.slice(0, MAX_PERIOD_VALUES);
        break;
      }
    }
    const headerRow = table.headerRows.length
      ? table.headerRows[table.headerRows.length - 1]! + 1
      : null;
    return {
      sheetName: table.sheetName,
      signature: headerSignature(table),
      headerRow,
      confidence: table.confidence,
      rowCount: working.rows.length,
      metaLines: table.metaLines.map(redactPersonnummer),
      periodSuggestions: suggestPeriod(e.fileName, table.metaLines, dateValues),
      companySuggestion: suggestCompany(e.fileName, table.metaLines),
      asOfSuggestion: suggestAsOfDate([...table.metaLines, e.fileName], today),
    };
  }

  private recognize(req: Extract<IngestRequest, { op: "recognize" }>): RecognizeResponse {
    const e = this.entry(req.fileId);
    if (!e.workbook) throw new IngestError("Filen innehåller ingen tabell.");
    const defaultSheet = pickSheet(e.workbook)?.name;
    if (defaultSheet === undefined) throw new ReadError("Filen innehåller inget kalkylblad.");
    const sheetForHint: Record<string, string> = {};
    const wanted = new Set<string>([defaultSheet]);
    for (const hint of req.hints) {
      const name = pickSheet(e.workbook, hint)?.name;
      if (name !== undefined) {
        sheetForHint[hint] = name;
        wanted.add(name);
      }
    }
    const sheets: Record<string, SheetSummary> = {};
    for (const name of wanted) sheets[name] = this.summary(e, this.table(e, name), req.today);
    return { ok: true, op: "recognize", defaultSheet, sheetForHint, sheets };
  }

  private inspect(req: Extract<IngestRequest, { op: "inspect" }>): InspectResponse {
    const e = this.entry(req.fileId);
    const { table, working } = this.table(e, req.sheetHint, req.headerRow);
    const suggestions = suggestMappings(working, { datasetKey: req.datasetKey ?? undefined });
    const columns: SourceColumnInfo[] = working.columns.map((name, i) => {
      const values = columnValues(working, name);
      const header = working.headers?.[name] ?? name;
      const sug = suggestions[i];
      const locked = sug ? isLockedRemoved(sug, values) : false;
      return {
        name,
        header: redactPersonnummer(header),
        samples: distinctValues(working, name, SAMPLE_VALUES),
        inferredType: inferColumnType(values.slice(0, 1000), header).type,
        personal: (sug?.personal ?? false) || locked,
        locked,
      };
    });
    const headerRow = table.headerRows.length
      ? table.headerRows[table.headerRows.length - 1]! + 1
      : null;
    return {
      ok: true,
      op: "inspect",
      sheetName: table.sheetName,
      sheets: e.workbook!.sheets.map((s) => ({ name: s.name, hidden: s.hidden })),
      headerRow,
      confidence: table.confidence,
      rowCount: working.rows.length,
      signature: headerSignature(table),
      columns,
      suggestions,
    };
  }

  private preview(req: Extract<IngestRequest, { op: "preview" }>): PreviewResponse {
    const e = this.entry(req.fileId);
    const { working } = this.table(e, req.sheetHint, req.headerRow);
    const stepped = applySteps(working, req.steps, { aliases: req.aliases });
    const t = stepped.table;
    const limit = req.limit ?? 20;
    const rows: PreviewRow[] = t.rows.slice(0, limit).map((row) => {
      const values: Record<string, string> = {};
      for (const c of t.columns) values[c] = displayValue(row.values[c]);
      return { sourceRow: row.sourceRow, values };
    });
    const samples: Record<string, string[]> = {};
    const inferred: Record<string, ColumnType> = {};
    for (const c of t.columns) {
      samples[c] = distinctValues(t, c, SAMPLE_VALUES);
      inferred[c] = inferColumnType(columnValues(t, c).slice(0, 1000), t.headers?.[c] ?? c).type;
    }
    const distinct: Record<string, string[]> = {};
    for (const c of req.distinctFor ?? []) {
      if (t.columns.includes(c)) distinct[c] = distinctRawValues(t, c);
    }
    const headers: Record<string, string> = {};
    for (const c of t.columns) headers[c] = redactPersonnummer(t.headers?.[c] ?? c);
    const issues = stepped.issues.slice(0, 50).map((i) => ({
      ...i,
      value: redactPersonnummer(i.value),
      message: redactPersonnummer(i.message),
    }));
    return {
      ok: true,
      op: "preview",
      columns: t.columns,
      headers,
      rows,
      rowCount: t.rows.length,
      sums: measureSums(t, req.measures),
      samples,
      inferred,
      suggestions: suggestMappings(t, { datasetKey: req.datasetKey ?? undefined }),
      issues,
      issueCount: stepped.issues.length,
      skippedCount: stepped.skipped.length,
      unknownLookups: stepped.unknownLookups,
      distinct,
    };
  }

  private async apply(req: Extract<IngestRequest, { op: "apply" }>): Promise<ApplyResponse> {
    const e = this.entry(req.fileId);
    if (!e.workbook) throw new IngestError("SIE-filer behöver ingen mall.");
    const result = await runTemplate(e.workbook, req.template, req.choices, {
      aliases: req.aliases,
      fileSha256: e.sha256,
      fileSize: e.size,
      ...(req.headerRow !== undefined ? { headerRow: req.headerRow } : {}),
    });
    return { ok: true, op: "apply", result };
  }
}
