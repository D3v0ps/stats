// Public API of the metric engine (module E).
export {
  BUDGET_LABEL,
  OTHERS_LABEL,
  UNALLOCATED_LABEL,
  UNASSIGNED_LABEL,
  comparisonPlan,
  companiesOf,
  dataRangeOf,
  isAdditiveKind,
  notApplicableDimensions,
  runMetricQuery,
  type ComparisonPlan,
  type DataRange,
} from "./engine";
export { describeDelta, makeCompareCell } from "./compare";
export {
  FLAT_PCT_THRESHOLD,
  FLAT_PP_THRESHOLD,
  HEADLINE_MAX_LENGTH,
  headlineSubjectOf,
  headlineTrend,
  normalizeHeadline,
  suggestHeadline,
  upperSv,
  type HeadlineInput,
  type HeadlineTrend,
} from "./headline";
export {
  DEFAULT_TOPLIST_N,
  DELTA_COLUMN_LABEL,
  FOOTNOTE_COMPANY_SUM,
  FOOTNOTE_NO_DATA,
  PREVIOUS_YEAR_SERIES_LABEL,
  TOTAL_ROW_LABEL,
  assertNoPersonalDimensions,
  resolveReport,
  resolveSlide,
  resolveWidget,
  type ReportResolveContext,
  type ResolveContext,
  type WidgetResolveContext,
} from "./resolve";
export {
  BUDGET_METRIC_KEY,
  MemoryMetricDataSource,
  type MemoryFact,
  type MemoryLedgerRow,
  type MemorySlice,
  type MemorySourceInput,
} from "./memory-source";
export { catalogAccountGroups, catalogDefinitions } from "./catalog";
export { FormulaSyntaxError, MetricConfigError, PersonalDataError } from "./errors";
export {
  MAX_FORMULA_DEPTH,
  evaluateFormula,
  formatFormula,
  parseFormula,
  referencedKeys,
  tokenize,
  validateFormulas,
  type FormulaIssue,
  type FormulaIssueCode,
  type FormulaNode,
} from "./formula";
