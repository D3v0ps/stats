// Public API of the ingest module (pure TS; runs in a Web Worker and in Node).
export {
  readWorkbook,
  sniffFormat,
  ReadError,
  parseCsv,
  sniffDelimiter,
  CSV_DELIMITERS,
} from "./read";
export type { CsvDelimiter } from "./read";

export {
  detectTable,
  detectTableWithHeaderRow,
  pickSheet,
  type DetectOptions,
} from "./header-detect";

export {
  headerSignature,
  diffSignature,
  matchTemplates,
  suggestPeriod,
  suggestCompany,
  type TemplateCandidate,
  type TemplateMatch,
  type PeriodSuggestion,
  type CompanySuggestion,
  type SuggestionSource,
} from "./recognize";

export {
  fromDetected,
  convertCell,
  uniqueColumnNames,
  columnValues,
  valueText,
  type CellValue,
  type WorkingRow,
  type WorkingTable,
} from "./working";

export {
  applySteps,
  applyStep,
  replaySteps,
  STEP_LABELS,
  stepLabel,
  type AliasTables,
  type ApplyResult,
  type StepContext,
  type StepResult,
} from "./pipeline";

export {
  inferColumnType,
  suggestMappings,
  isLockedRemoved,
  type InferredType,
  type SuggestOptions,
} from "./columns";

export {
  aggregateTable,
  PersonalDataError,
  MISSING_LABEL,
  type AggregateResult,
} from "./aggregate";

export { buildCases, type CasesChoices, type CasesResult } from "./cases";

export { resolveDims, type DimensionDictionary, type ResolveResult } from "./resolve";

export {
  runTemplate,
  loadTable,
  factsContentHash,
  IngestError,
  type RunContext,
  type LoadOptions,
  type LoadedTable,
} from "./run";

export { cellText, classifyCell, columnLetter, type CellClass } from "./cells";
