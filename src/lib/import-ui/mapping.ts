// The mapping view's state and its conversion to and from a TemplateConfig.
//
// The user edits one row per source column (new name, type, usage, metric or
// dimension, keep/remove) plus a list of tool steps. The saved template is a
// plain step list: removed columns are dropped first (their values never reach
// previews or reports), then renames, then the tools in order, then the column
// order. The budget sign and a header row picked by hand are fields of the
// config. Converting back recognizes that shape, so a saved template opens
// again exactly as it was mapped.
import {
  TemplateConfigSchema,
  type BudgetSign,
  type CasesConfig,
  type ColumnMapping,
  type ColumnType,
  type ColumnUsage,
  type CompanyCode,
  type Counter,
  type DatasetKind,
  type MetricKind,
  type Step,
  type TemplateConfig,
} from "@/lib/contracts";
import { STEP_LABELS } from "@/lib/ingest/pipeline/util";
import { isSafeColumnName } from "@/lib/ingest/working";
import { renameInSteps, stepInputs, stepOutputs, stepRemoves, stepsReference } from "./steps";

// ---- Types ------------------------------------------------------------------

/** What the worker reports about one source column of the file. */
export interface SourceColumnInfo {
  /** Working name (normalized header, de-duplicated). */
  name: string;
  /** Header as written in the file. */
  header: string;
  /** Up to five example values as text (personnummer masked). */
  samples: string[];
  inferredType: ColumnType;
  /** Looks like personal data (name, e-mail, phone, address, personnummer). */
  personal: boolean;
  /** Holds personnummer: can never be kept. */
  locked: boolean;
}

export interface SourceSetting {
  name: string;
  header: string;
  /** New name; equals `name` when unchanged. */
  rename: string;
  keep: boolean;
  personal: boolean;
  locked: boolean;
}

export interface FieldMapping {
  type: ColumnType;
  usage: ColumnUsage;
  metricKey?: string;
  dimensionKey?: string;
}

export interface CasesForm {
  interruptDateColumn?: string;
  /** Normalized raw result value -> resultattyp label ("Arbete", "Studier"). */
  resultMap: Record<string, string>;
  metrics: CasesConfig["metrics"];
  fromMonth?: string;
}

export interface MappingState {
  datasetKey: string | null;
  templateName: string;
  /** Source columns in file order. */
  sources: SourceSetting[];
  /** Tool steps; they refer to columns by their new names. */
  tools: Step[];
  /** Output column name -> mapping. */
  fields: Record<string, FieldMapping>;
  /** Preferred column order (output names); empty = file order. */
  order: string[];
  counters: Counter[];
  /** Used when no column has usage "company": a fixed company, or null = chosen per upload. */
  companyFixed: CompanyCode | null;
  /** Company column values -> company, when a column has usage "company". */
  companyMapping: Record<string, CompanyCode>;
  /** "Hur skrivs beloppen?" (budget files only; TableTemplateConfig.budgetSign). */
  budgetSign: BudgetSign;
  /** 0-based sheet row of the header picked by hand; undefined = detected. */
  headerRow?: number;
  cases: CasesForm;
}

/** The parts of the catalog the mapping view needs (DB lists and the seed both fit). */
export interface MappingCatalog {
  datasets: { key: string; name: string; kind: DatasetKind; dimensions: string[] }[];
  metrics: { key: string; name: string; kind: MetricKind; datasetKey: string | null }[];
  dimensions: { key: string; label: string; personal: boolean }[];
}

export interface MappingProblem {
  message: string;
  /** Blocking problems stop saving; the others are shown as advice. */
  blocking: boolean;
}

// ---- Small helpers ----------------------------------------------------------

export const isKept = (s: SourceSetting): boolean => s.keep && !s.locked;

const CASE_USAGES: ColumnUsage[] = [
  "case_key",
  "case_start",
  "case_end",
  "case_interrupt",
  "case_result",
  "case_result_date",
];
/** Usages only one column can have. */
const SINGLE_USAGES: ColumnUsage[] = ["period", "company", ...CASE_USAGES];

export function datasetOf(catalog: MappingCatalog, key: string | null) {
  return key ? catalog.datasets.find((d) => d.key === key) : undefined;
}

export function datasetKind(catalog: MappingCatalog, key: string | null): DatasetKind | null {
  return datasetOf(catalog, key)?.kind ?? null;
}

/** Metrics a column can feed: sum and snapshot metrics of the dataset. */
export function measureMetrics(catalog: MappingCatalog, datasetKey: string | null) {
  return catalog.metrics.filter(
    (m) => m.datasetKey === datasetKey && (m.kind === "sum" || m.kind === "snapshot"),
  );
}

/** Usages offered for a dataset kind (table: no case usages; cases: no measure/period). */
export function usagesFor(kind: DatasetKind | null): ColumnUsage[] {
  if (kind === "cases") return ["dimension", "company", "ignore", ...CASE_USAGES];
  return ["measure", "dimension", "period", "company", "ignore"];
}

const KNOWN_CASE_METRICS: Record<string, CasesConfig["metrics"]> = {
  ip_konsulter: {
    active: "anstallda_konsulter",
    started: "nyanstallda",
    ended: "avslutade_anstallningar",
    tenureMonthsSum: "anstallningsmanader",
  },
  wb_deltagare: {
    active: "aktiva_deltagare",
    started: "nya_deltagare",
    ended: "avslutade_deltagare",
    interrupted: "avbrott_deltagare",
    results: "resultat_deltagare",
  },
};

/** The measures a cases dataset produces by default (only metrics that exist). */
export function defaultCaseMetrics(
  catalog: MappingCatalog,
  datasetKey: string | null,
): CasesConfig["metrics"] {
  const known = datasetKey ? KNOWN_CASE_METRICS[datasetKey] : undefined;
  if (!known) return {};
  const exists = new Set(
    catalog.metrics.filter((m) => m.datasetKey === datasetKey).map((m) => m.key),
  );
  const out: CasesConfig["metrics"] = {};
  for (const [role, key] of Object.entries(known) as [keyof CasesConfig["metrics"], string][]) {
    if (exists.has(key)) out[role] = key;
  }
  return out;
}

/**
 * Case measures of a saved template as the mapping edits them. The deprecated
 * per-group average (tenureMonths, which ingest ignores) is dropped; when the
 * template had it and no tenure sum, the dataset's tenure sum takes its place.
 */
export function migrateCaseMetrics(
  metrics: CasesConfig["metrics"],
  catalog: MappingCatalog,
  datasetKey: string | null,
): CasesConfig["metrics"] {
  const { tenureMonths, ...rest } = metrics;
  if (tenureMonths === undefined || rest.tenureMonthsSum !== undefined) return rest;
  const sum = defaultCaseMetrics(catalog, datasetKey).tenureMonthsSum;
  return sum ? { ...rest, tenureMonthsSum: sum } : rest;
}

export const DEFAULT_RESULT_MAP: Record<string, string> = { arbete: "Arbete", studier: "Studier" };

// ---- Column flow ------------------------------------------------------------

export interface BrokenStep {
  index: number;
  step: Step;
  missing: string[];
  taken: string[];
}

export interface ColumnFlow {
  columns: string[];
  broken: BrokenStep[];
  /** Columns removed by merge/split/unpivot -> index of that step. */
  consumedBy: Record<string, number>;
  /** Columns created by a step -> index of that step. */
  createdBy: Record<string, number>;
}

/**
 * Follow the column list through the steps without data, mirroring the step
 * implementations: a step whose input is missing or whose new name is taken is
 * skipped (and reported), exactly as the pipeline skips it.
 */
export function simulateColumns(initial: readonly string[], steps: readonly Step[]): ColumnFlow {
  let cols = [...initial];
  const broken: BrokenStep[] = [];
  const consumedBy: Record<string, number> = {};
  const createdBy: Record<string, number> = {};
  steps.forEach((step, index) => {
    const missing = stepInputs(step).filter((c) => !cols.includes(c));
    const freed = stepRemoves(step);
    const outs = step.op === "rename" && step.to === step.column ? [] : stepOutputs(step);
    const taken = outs.filter((o) => cols.includes(o) && !freed.includes(o));
    if (missing.length || taken.length) {
      broken.push({ index, step, missing, taken });
      return;
    }
    const placeAtFirst = (sources: string[], created: string[]) => {
      const first = cols.findIndex((c) => sources.includes(c));
      const out: string[] = [];
      cols.forEach((c, k) => {
        if (k === first) out.push(...created);
        if (!sources.includes(c)) out.push(c);
      });
      return out;
    };
    switch (step.op) {
      case "rename":
        cols = cols.map((c) => (c === step.column ? step.to : c));
        break;
      case "drop":
        cols = cols.filter((c) => c !== step.column);
        break;
      case "merge":
        cols = placeAtFirst(step.columns, [step.into]);
        break;
      case "split":
        cols = cols.flatMap((c) => (c === step.column ? step.into : [c]));
        break;
      case "unpivot":
        cols = placeAtFirst(step.columns, [step.nameColumn, step.valueColumn]);
        break;
      case "constant":
        cols = [...cols, step.column];
        break;
      case "reorder":
        cols = [...step.order, ...cols.filter((c) => !step.order.includes(c))];
        break;
      default:
        break;
    }
    if (step.op === "merge" || step.op === "split" || step.op === "unpivot") {
      for (const c of freed) consumedBy[c] = index;
    }
    if (step.op !== "rename") for (const c of outs) createdBy[c] = index;
  });
  return { columns: cols, broken, consumedBy, createdBy };
}

// ---- Steps and columns of the saved template ---------------------------------

/** Drops for removed columns, then renames (the fixed head of every saved step list). */
export function headSteps(state: Pick<MappingState, "sources">): Step[] {
  const steps: Step[] = [];
  for (const s of state.sources) if (!isKept(s)) steps.push({ op: "drop", column: s.name });
  for (const s of state.sources) {
    if (isKept(s) && s.rename !== s.name)
      steps.push({ op: "rename", column: s.name, to: s.rename });
  }
  return steps;
}

/** Output columns after drops, renames and tools (before the column order). */
export function toolOutput(state: MappingState): ColumnFlow {
  return simulateColumns(
    state.sources.map((s) => s.name),
    [...headSteps(state), ...state.tools],
  );
}

/** Output columns in display order (the user's order first, then the rest). */
export function orderedOutput(state: MappingState): string[] {
  const cols = toolOutput(state).columns;
  const listed = state.order.filter((c) => cols.includes(c));
  return [...listed, ...cols.filter((c) => !listed.includes(c))];
}

/** The full step list of the template. */
export function mappingSteps(state: MappingState): Step[] {
  const steps = [...headSteps(state), ...state.tools];
  const flow = simulateColumns(
    state.sources.map((s) => s.name),
    steps,
  );
  const ordered = orderedOutput(state);
  if (ordered.some((c, i) => flow.columns[i] !== c)) {
    // reorder puts the listed columns first and keeps the rest in order: list the shortest prefix.
    for (let k = 1; k <= ordered.length; k++) {
      const listed = ordered.slice(0, k);
      const result = [...listed, ...flow.columns.filter((c) => !listed.includes(c))];
      if (result.every((c, i) => c === ordered[i])) {
        steps.push({ op: "reorder", order: listed });
        break;
      }
    }
  }
  return steps;
}

function sourceOfOutput(state: MappingState, column: string): SourceSetting | undefined {
  return state.sources.find((s) => isKept(s) && s.rename === column);
}

/** ColumnMapping list: removed source columns (keep:false) plus every output column. */
export function mappingColumns(state: MappingState): ColumnMapping[] {
  const out: ColumnMapping[] = [];
  for (const s of state.sources) {
    if (isKept(s)) continue;
    out.push({
      column: s.name,
      type: "text",
      usage: "ignore",
      personal: s.personal || s.locked,
      keep: false,
    });
  }
  for (const column of toolOutput(state).columns) {
    const f = state.fields[column] ?? { type: "text", usage: "ignore" };
    out.push({
      column,
      type: f.type,
      usage: f.usage,
      ...(f.usage === "measure" && f.metricKey ? { metricKey: f.metricKey } : {}),
      ...(f.usage === "dimension" && f.dimensionKey ? { dimensionKey: f.dimensionKey } : {}),
      personal: sourceOfOutput(state, column)?.personal ?? false,
      keep: true,
    });
  }
  return out;
}

function fieldWithUsage(state: MappingState, columns: readonly string[], usage: ColumnUsage) {
  return columns.find((c) => state.fields[c]?.usage === usage);
}

// ---- Validation -------------------------------------------------------------

/** Everything that stops (or should make the user think twice about) saving. */
export function validateMapping(state: MappingState, catalog: MappingCatalog): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const block = (message: string) => problems.push({ message, blocking: true });
  const advise = (message: string) => problems.push({ message, blocking: false });

  const dataset = datasetOf(catalog, state.datasetKey);
  if (!dataset) block("Välj vilken rapport det här är.");
  if (state.templateName.trim() === "") block("Ge mallen ett namn.");
  if (dataset?.kind === "ledger") block("Bokföringsfiler (SIE) läses in utan mappning.");

  // New names.
  for (const s of state.sources.filter(isKept)) {
    const name = s.rename.trim();
    if (name === "" || !isSafeColumnName(name))
      block(`Kolumnen ”${s.header}” behöver ett giltigt namn.`);
    else if (name !== s.rename)
      block(`Namnet ”${s.rename}” får inte börja eller sluta med mellanslag.`);
  }

  const head = headSteps(state);
  const flow = simulateColumns(
    state.sources.map((s) => s.name),
    [...head, ...state.tools],
  );
  for (const b of flow.broken) {
    if (b.step.op === "rename" && b.index < head.length) {
      block(`Kolumnen ”${b.step.column}” kan inte heta ”${b.step.to}”, namnet används redan.`);
      continue;
    }
    if (b.index < head.length) continue;
    const label = `Steg ${b.index - head.length + 1} (${STEP_LABELS[b.step.op]})`;
    for (const m of b.missing) block(`${label} använder kolumnen ”${m}”, som inte finns.`);
    for (const t of b.taken) block(`${label} skapar kolumnen ”${t}”, men namnet används redan.`);
  }
  if (!dataset) return problems;

  const columns = flow.columns;
  const fields = columns.map((c) => [c, state.fields[c]] as const);
  const metricsOfDataset = new Set(measureMetrics(catalog, dataset.key).map((m) => m.key));
  const dimLabel = (key: string) => catalog.dimensions.find((d) => d.key === key)?.label ?? key;

  for (const usage of SINGLE_USAGES) {
    const using = fields.filter(([, f]) => f?.usage === usage).map(([c]) => c);
    if (using.length > 1)
      block(
        `Bara en kolumn kan vara ”${usageName(usage)}” (nu: ${using.map((c) => `”${c}”`).join(", ")}).`,
      );
  }

  const usedDims = new Map<string, string>();
  for (const [column, f] of fields) {
    if (!f) continue;
    if (f.usage === "dimension") {
      if (!f.dimensionKey) {
        block(`Kolumnen ”${column}”: välj vad den ska grupperas på, eller ”Ta inte med”.`);
        continue;
      }
      if (!dataset.dimensions.includes(f.dimensionKey)) {
        block(
          `Kolumnen ”${column}”: ${dimLabel(f.dimensionKey)} går inte att gruppera på i ${dataset.name}.`,
        );
      }
      const prev = usedDims.get(f.dimensionKey);
      if (prev) block(`${dimLabel(f.dimensionKey)} är vald för både ”${prev}” och ”${column}”.`);
      usedDims.set(f.dimensionKey, column);
      const personalDim =
        catalog.dimensions.find((d) => d.key === f.dimensionKey)?.personal ?? false;
      if (sourceOfOutput(state, column)?.personal && !personalDim) {
        advise(
          `Kolumnen ”${column}” ser ut att innehålla personuppgifter men grupperas på ${dimLabel(f.dimensionKey)}.`,
        );
      }
    }
    if (dataset.kind === "table" && CASE_USAGES.includes(f.usage)) {
      block(
        `Kolumnen ”${column}”: ”${usageName(f.usage)}” används bara i deltagar- och anställningslistor.`,
      );
    }
  }

  if (dataset.kind === "table") {
    const usedMetrics = new Map<string, string>();
    let measures = 0;
    for (const [column, f] of fields) {
      if (f?.usage !== "measure") continue;
      if (!f.metricKey) {
        block(`Kolumnen ”${column}”: välj vilket mått siffrorna hör till.`);
        continue;
      }
      measures++;
      if (!metricsOfDataset.has(f.metricKey))
        block(`Kolumnen ”${column}”: måttet hör inte till ${dataset.name}.`);
      const prev = usedMetrics.get(f.metricKey);
      if (prev) block(`Samma mått är valt för både ”${prev}” och ”${column}”.`);
      usedMetrics.set(f.metricKey, column);
    }
    for (const c of state.counters) {
      if (!metricsOfDataset.has(c.metricKey))
        block("Måttet för ”Räkna rader” hör inte till rapporten.");
      if (usedMetrics.has(c.metricKey))
        block("Samma mått används både för en kolumn och för ”Räkna rader”.");
    }
    if (measures === 0 && state.counters.length === 0) {
      block("Välj minst en kolumn som ”Siffra att räkna på”, eller lägg till ”Räkna rader”.");
    }
    if (
      dataset.key === "budget" &&
      state.budgetSign === "positive" &&
      !fields.some(([, f]) => f?.usage === "dimension" && f.dimensionKey === "kontogrupp")
    ) {
      block(
        "Med ”Alla belopp positiva” tas tecknet från kontogruppen: välj kolumnen som grupperas på Kontogrupp.",
      );
    }
    const companyColumn = fieldWithUsage(state, columns, "company");
    if (!companyColumn && state.companyFixed === null) {
      advise("Bolaget väljs vid varje uppladdning.");
    }
  } else if (dataset.kind === "cases") {
    if (!fieldWithUsage(state, columns, "case_start")) block("Välj kolumnen med startdatum.");
    for (const [column, f] of fields) {
      if (f?.usage === "measure" || f?.usage === "period") {
        block(
          `Kolumnen ”${column}”: i den här rapporten räknas deltagare och anställningar, inte siffror i kolumner.`,
        );
      }
    }
    const metrics = Object.values(state.cases.metrics).filter(Boolean);
    if (metrics.length === 0) block("Välj minst ett mått att räkna fram.");
    const allowed = new Set(
      catalog.metrics.filter((m) => m.datasetKey === dataset.key).map((m) => m.key),
    );
    for (const key of metrics)
      if (key && !allowed.has(key)) block("Ett av måtten hör inte till rapporten.");
    if (state.cases.metrics.results && !fieldWithUsage(state, columns, "case_result")) {
      block("Välj kolumnen med resultat, eller ta bort måttet för arbete och studier.");
    }
    if (state.cases.metrics.results && usedDims.has("resultattyp")) {
      block("Resultat räknas redan som eget mått och kan inte också vara en gruppering.");
    }
    if (state.cases.interruptDateColumn && !columns.includes(state.cases.interruptDateColumn)) {
      block(`Kolumnen för avbrottsdatum (”${state.cases.interruptDateColumn}”) finns inte.`);
    }
  }
  return problems;
}

export function usageName(usage: ColumnUsage): string {
  const names: Record<ColumnUsage, string> = {
    measure: "Siffra att räkna på",
    dimension: "Gruppera på",
    period: "Datum/period",
    company: "Bolag",
    ignore: "Ta inte med",
    case_key: "Id",
    case_start: "Startdatum",
    case_end: "Slutdatum",
    case_interrupt: "Avbrott",
    case_result: "Resultat",
    case_result_date: "Resultatdatum",
  };
  return names[usage];
}

export const hasBlockingProblems = (problems: readonly MappingProblem[]) =>
  problems.some((p) => p.blocking);

// ---- To TemplateConfig --------------------------------------------------------

/** The template config for a valid mapping (call validateMapping first). */
export function toTemplateConfig(state: MappingState, catalog: MappingCatalog): TemplateConfig {
  const kind = datasetKind(catalog, state.datasetKey);
  const steps = mappingSteps(state);
  const columns = mappingColumns(state);
  const outputs = toolOutput(state).columns;
  const companyColumn = fieldWithUsage(state, outputs, "company");
  const company = companyColumn
    ? { kind: "column" as const, column: companyColumn, mapping: { ...state.companyMapping } }
    : state.companyFixed
      ? { kind: "fixed" as const, company: state.companyFixed }
      : { kind: "per_upload" as const };

  const headerRow = state.headerRow !== undefined ? { headerRow: state.headerRow } : {};

  if (kind === "cases") {
    const col = (usage: ColumnUsage) => fieldWithUsage(state, outputs, usage);
    const startColumn = col("case_start");
    if (!startColumn) throw new Error("Startkolumn saknas.");
    const opt = (key: string, value: string | undefined) => (value ? { [key]: value } : {});
    return TemplateConfigSchema.parse({
      kind: "cases",
      steps,
      columns,
      company,
      cases: {
        ...opt("keyColumn", col("case_key")),
        startColumn,
        ...opt("endColumn", col("case_end")),
        ...opt("interruptColumn", col("case_interrupt")),
        ...opt("interruptDateColumn", state.cases.interruptDateColumn),
        ...opt("resultColumn", col("case_result")),
        resultMap: state.cases.resultMap,
        ...opt("resultDateColumn", col("case_result_date")),
        groupBy: outputs.filter(
          (c) => state.fields[c]?.usage === "dimension" && state.fields[c]?.dimensionKey,
        ),
        metrics: state.cases.metrics,
        ...opt("fromMonth", state.cases.fromMonth),
      },
      ...headerRow,
    });
  }
  const periodColumn = fieldWithUsage(state, outputs, "period");
  return TemplateConfigSchema.parse({
    kind: "table",
    steps,
    columns,
    counters: state.counters,
    period: periodColumn ? { kind: "column", column: periodColumn } : { kind: "per_upload" },
    company,
    scenario: state.datasetKey === "budget" ? "budget" : "utfall",
    ...(state.datasetKey === "budget" ? { budgetSign: state.budgetSign } : {}),
    ...headerRow,
  });
}

// ---- Initial state and from TemplateConfig -------------------------------------

function fieldFromMapping(
  m: Pick<ColumnMapping, "type" | "usage" | "metricKey" | "dimensionKey">,
): FieldMapping {
  return {
    type: m.type,
    usage: m.usage,
    ...(m.metricKey ? { metricKey: m.metricKey } : {}),
    ...(m.dimensionKey ? { dimensionKey: m.dimensionKey } : {}),
  };
}

/**
 * A fresh mapping for a new report type from the file's columns and the
 * first-guess suggestions (suggestMappings). Personal columns start removed;
 * personnummer columns can never be kept.
 */
export function initialMapping(
  sources: readonly SourceColumnInfo[],
  suggestions: readonly ColumnMapping[],
  opts: { datasetKey: string | null; templateName: string; catalog: MappingCatalog },
): MappingState {
  const byName = new Map(suggestions.map((m) => [m.column, m]));
  const fields: Record<string, FieldMapping> = {};
  const settings: SourceSetting[] = sources.map((s) => {
    const sug = byName.get(s.name);
    fields[s.name] = sug ? fieldFromMapping(sug) : { type: s.inferredType, usage: "ignore" };
    const personal = s.personal || s.locked || (sug?.personal ?? false);
    return {
      name: s.name,
      header: s.header,
      rename: s.name,
      keep: !s.locked && !personal && (sug?.keep ?? true),
      personal,
      locked: s.locked,
    };
  });
  return {
    datasetKey: opts.datasetKey,
    templateName: opts.templateName,
    sources: settings,
    tools: [],
    fields,
    order: [],
    counters: [],
    companyFixed: null,
    companyMapping: {},
    // Budget sheets are usually written as a result budget (revenue +, costs −).
    budgetSign: "result",
    cases: {
      resultMap: { ...DEFAULT_RESULT_MAP },
      metrics: defaultCaseMetrics(opts.catalog, opts.datasetKey),
    },
  };
}

/**
 * Open a saved template for editing. Leading drops/renames of source columns
 * become keep/rename settings, later drops of source columns that no earlier
 * step reads are hoisted (the column is simply removed), and a trailing reorder
 * becomes the column order. Everything else stays a tool step. Budget templates
 * saved before TableTemplateConfig.budgetSign wrote a revenue-plus sheet as a
 * negate step on the measure that nothing after it reads: such a step becomes
 * budgetSign "result". The deprecated tenure average of a cases template
 * becomes the tenure sum (migrateCaseMetrics).
 */
export function fromTemplateConfig(
  config: TemplateConfig,
  sources: readonly SourceColumnInfo[],
  opts: { datasetKey: string; templateName: string; catalog: MappingCatalog },
): MappingState {
  if (config.kind === "sie") throw new Error("SIE-mallar har ingen kolumnmappning.");
  const sourceNames = new Set(sources.map((s) => s.name));
  const removed = new Set(
    config.columns
      .filter((c) => c.keep === false && sourceNames.has(c.column))
      .map((c) => c.column),
  );
  const personalCols = new Set(config.columns.filter((c) => c.personal).map((c) => c.column));
  const renames = new Map<string, string>();

  const steps = [...(config.steps ?? [])];
  let head = true;
  const tools: Step[] = [];
  steps.forEach((step, i) => {
    if (head && step.op === "drop" && sourceNames.has(step.column) && !renames.has(step.column)) {
      removed.add(step.column);
      return;
    }
    if (
      head &&
      step.op === "rename" &&
      sourceNames.has(step.column) &&
      !renames.has(step.column) &&
      !removed.has(step.column)
    ) {
      renames.set(step.column, step.to);
      return;
    }
    head = false;
    if (
      step.op === "drop" &&
      sourceNames.has(step.column) &&
      !renames.has(step.column) &&
      ![...renames.values()].includes(step.column) &&
      !stepsReference(steps.slice(0, i), step.column) &&
      !steps.slice(0, i).some((s) => stepOutputs(s).includes(step.column))
    ) {
      removed.add(step.column);
      return;
    }
    tools.push(step);
  });

  let order: string[] = [];
  const last = tools[tools.length - 1];
  if (last?.op === "reorder") {
    order = [...last.order];
    tools.pop();
  }

  const fields: Record<string, FieldMapping> = {};
  for (const c of config.columns) {
    if (c.keep === false) continue;
    fields[c.column] = fieldFromMapping(c);
  }

  let budgetSign: BudgetSign = (config.kind === "table" && config.budgetSign) || "ledger";
  if (opts.datasetKey === "budget" && config.kind === "table" && !config.budgetSign) {
    const measures = Object.entries(fields)
      .filter(([, f]) => f.usage === "measure")
      .map(([c]) => c);
    for (const column of measures) {
      // The legacy sign step came after the tools: the last negate of the column.
      let idx = -1;
      tools.forEach((s, i) => {
        if (s.op === "negate" && s.column === column) idx = i;
      });
      if (idx >= 0 && !stepsReference(tools.slice(idx + 1), column)) {
        budgetSign = "result";
        tools.splice(idx, 1);
      }
    }
  }

  const sourceSettings: SourceSetting[] = sources.map((s) => {
    const keep = !removed.has(s.name) && !s.locked;
    return {
      name: s.name,
      header: s.header,
      rename: keep ? (renames.get(s.name) ?? s.name) : s.name,
      keep,
      personal: s.personal || s.locked || personalCols.has(s.name),
      locked: s.locked,
    };
  });

  const state: MappingState = {
    datasetKey: opts.datasetKey,
    templateName: opts.templateName,
    sources: sourceSettings,
    tools,
    fields,
    order,
    counters: config.kind === "table" ? [...(config.counters ?? [])] : [],
    companyFixed: config.company.kind === "fixed" ? config.company.company : null,
    companyMapping: config.company.kind === "column" ? { ...config.company.mapping } : {},
    budgetSign,
    ...(config.headerRow !== undefined ? { headerRow: config.headerRow } : {}),
    cases: {
      resultMap:
        config.kind === "cases" ? { ...(config.cases.resultMap ?? {}) } : { ...DEFAULT_RESULT_MAP },
      metrics:
        config.kind === "cases"
          ? migrateCaseMetrics(config.cases.metrics, opts.catalog, opts.datasetKey)
          : defaultCaseMetrics(opts.catalog, opts.datasetKey),
      ...(config.kind === "cases" && config.cases.interruptDateColumn
        ? { interruptDateColumn: config.cases.interruptDateColumn }
        : {}),
      ...(config.kind === "cases" && config.cases.fromMonth
        ? { fromMonth: config.cases.fromMonth }
        : {}),
    },
  };

  // Keep the usages consistent with the sources the config names.
  const setUsage = (column: string | undefined, usage: ColumnUsage) => {
    if (!column) return;
    const f = state.fields[column] ?? {
      type: usage === "case_start" || usage === "case_end" ? "date" : "text",
      usage,
    };
    state.fields[column] = { ...f, usage };
  };
  if (config.kind === "table" && config.period.kind === "column")
    setUsage(config.period.column, "period");
  if (config.company.kind === "column") setUsage(config.company.column, "company");
  if (config.kind === "cases") {
    const c = config.cases;
    setUsage(c.keyColumn, "case_key");
    setUsage(c.startColumn, "case_start");
    setUsage(c.endColumn, "case_end");
    setUsage(c.interruptColumn, "case_interrupt");
    setUsage(c.resultColumn, "case_result");
    setUsage(c.resultDateColumn, "case_result_date");
  }
  return state;
}

// ---- Edits ----------------------------------------------------------------------

/** The default template name: the report's name, plus the sheet for multi-sheet workbooks. */
export function defaultTemplateName(datasetName: string, sheetName?: string): string {
  return sheetName ? `${datasetName} – ${sheetName}` : datasetName;
}

/**
 * Pick the dataset; suggestions (for the source columns) replace the field
 * mappings. `sheetName` (workbooks with several sheets) goes into the default
 * template name, so "Budget – MB AB" and "Budget – MB Restart" tell apart.
 */
export function setDataset(
  state: MappingState,
  datasetKey: string,
  catalog: MappingCatalog,
  suggestions?: readonly ColumnMapping[],
  sheetName?: string,
): MappingState {
  if (datasetKey === state.datasetKey) return state;
  const fields = { ...state.fields };
  if (suggestions) {
    for (const s of state.sources) {
      const sug = suggestions.find((m) => m.column === s.name);
      if (sug) fields[s.rename] = fieldFromMapping(sug);
    }
  }
  const allowedMetrics = new Set(measureMetrics(catalog, datasetKey).map((m) => m.key));
  const dims = datasetOf(catalog, datasetKey)?.dimensions ?? [];
  for (const [c, f] of Object.entries(fields)) {
    const next = { ...f };
    if (next.metricKey && !allowedMetrics.has(next.metricKey)) delete next.metricKey;
    if (next.dimensionKey && !dims.includes(next.dimensionKey)) delete next.dimensionKey;
    // A grouping the new dataset has no dimension for is left out rather than left blank.
    if (next.usage === "dimension" && !next.dimensionKey) next.usage = "ignore";
    fields[c] = next;
  }
  const dataset = datasetOf(catalog, datasetKey);
  const oldDataset = datasetOf(catalog, state.datasetKey);
  const keepName =
    state.templateName.trim() !== "" &&
    (!oldDataset ||
      (state.templateName !== oldDataset.name &&
        state.templateName !== defaultTemplateName(oldDataset.name, sheetName)));
  return {
    ...state,
    datasetKey,
    fields,
    templateName: keepName
      ? state.templateName
      : dataset
        ? defaultTemplateName(dataset.name, sheetName)
        : state.templateName,
    counters: state.counters.filter((c) => allowedMetrics.has(c.metricKey)),
    cases: { ...state.cases, metrics: defaultCaseMetrics(catalog, datasetKey) },
  };
}

export function setTemplateName(state: MappingState, templateName: string): MappingState {
  return { ...state, templateName };
}

/** Give a source column a new name; every reference follows. */
export function renameSource(
  state: MappingState,
  sourceName: string,
  newName: string,
): MappingState {
  const src = state.sources.find((s) => s.name === sourceName);
  if (!src || src.rename === newName) return state;
  const from = src.rename;
  const to = newName;
  const fields = { ...state.fields };
  if (from in fields) {
    fields[to] = fields[from]!;
    delete fields[from];
  }
  return {
    ...state,
    sources: state.sources.map((s) => (s.name === sourceName ? { ...s, rename: to } : s)),
    tools: renameInSteps(state.tools, from, to),
    fields,
    order: state.order.map((c) => (c === from ? to : c)),
    cases:
      state.cases.interruptDateColumn === from
        ? { ...state.cases, interruptDateColumn: to }
        : state.cases,
  };
}

/** Keep or remove a source column. Personnummer columns can never be kept. */
export function setKeep(state: MappingState, sourceName: string, keep: boolean): MappingState {
  const src = state.sources.find((s) => s.name === sourceName);
  if (!src || src.locked || src.keep === keep) return state;
  // A removed column has no name of its own: it goes back to its file name.
  return {
    ...state,
    sources: state.sources.map((s) =>
      s.name === sourceName ? { ...s, keep, rename: keep ? s.rename : s.name } : s,
    ),
    fields:
      keep || src.rename === src.name
        ? state.fields
        : renameKey(state.fields, src.rename, src.name),
  };
}

function renameKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  if (!(from in record)) return record;
  const out = { ...record };
  out[to] = out[from]!;
  delete out[from];
  return out;
}

/**
 * Change a column's mapping. Usages only one column can have (period, company,
 * the case fields) move: the previous holder goes back to "Ta inte med".
 */
export function setField(
  state: MappingState,
  column: string,
  patch: Partial<FieldMapping>,
): MappingState {
  const current = state.fields[column] ?? { type: "text", usage: "ignore" };
  const next: FieldMapping = { ...current, ...patch };
  if (next.usage !== "measure") delete next.metricKey;
  if (next.usage !== "dimension") delete next.dimensionKey;
  if (
    patch.usage === "case_start" ||
    patch.usage === "case_end" ||
    patch.usage === "case_result_date"
  ) {
    next.type = "date";
  }
  const fields = { ...state.fields, [column]: next };
  if (patch.usage && SINGLE_USAGES.includes(patch.usage)) {
    for (const [c, f] of Object.entries(fields)) {
      if (c !== column && f.usage === patch.usage) fields[c] = { ...f, usage: "ignore" };
    }
  }
  return { ...state, fields };
}

/** "En kolumn i filen" (column) or "Hela filen är en månad" (null). */
export function setPeriodColumn(state: MappingState, column: string | null): MappingState {
  if (column) return setField(state, column, { usage: "period", type: "date" });
  const fields = { ...state.fields };
  for (const [c, f] of Object.entries(fields))
    if (f.usage === "period") fields[c] = { ...f, usage: "ignore" };
  return { ...state, fields };
}

const COMPANY_HEADER = /bolag|företag|foretag|company/i;

/**
 * The column to start with when the user switches period or company to "En
 * kolumn i filen". Taking a column means its old use is cleared, so a column
 * that is not used for anything yet is preferred over, say, the customer
 * column the user already mapped.
 */
export function defaultColumnFor(
  state: MappingState,
  outputs: readonly string[],
  usage: "period" | "company",
): string | undefined {
  const free = (c: string) => (state.fields[c]?.usage ?? "ignore") === "ignore";
  const fits =
    usage === "period"
      ? (c: string) => state.fields[c]?.type === "date"
      : (c: string) => COMPANY_HEADER.test(c);
  return (
    outputs.find((c) => state.fields[c]?.usage === usage) ??
    outputs.find((c) => fits(c) && free(c)) ??
    outputs.find(free) ??
    outputs.find(fits) ??
    outputs[0]
  );
}

export type CompanyChoice =
  | { kind: "column"; column: string }
  | { kind: "fixed"; company: CompanyCode }
  | { kind: "per_upload" };

export function companyChoice(state: MappingState): CompanyChoice {
  const column = fieldWithUsage(state, toolOutput(state).columns, "company");
  if (column) return { kind: "column", column };
  return state.companyFixed
    ? { kind: "fixed", company: state.companyFixed }
    : { kind: "per_upload" };
}

export function setCompanyChoice(state: MappingState, choice: CompanyChoice): MappingState {
  if (choice.kind === "column") {
    return {
      ...setField(state, choice.column, { usage: "company", type: "text" }),
      companyFixed: null,
    };
  }
  const fields = { ...state.fields };
  for (const [c, f] of Object.entries(fields))
    if (f.usage === "company") fields[c] = { ...f, usage: "ignore" };
  return { ...state, fields, companyFixed: choice.kind === "fixed" ? choice.company : null };
}

export function setCompanyMapping(
  state: MappingState,
  value: string,
  company: CompanyCode | null,
): MappingState {
  const companyMapping = { ...state.companyMapping };
  if (company) companyMapping[value] = company;
  else delete companyMapping[value];
  return { ...state, companyMapping };
}

export function addStep(state: MappingState, step: Step): MappingState {
  return { ...state, tools: [...state.tools, step] };
}

export function removeStep(state: MappingState, index: number): MappingState {
  if (index < 0 || index >= state.tools.length) return state;
  return { ...state, tools: state.tools.filter((_, i) => i !== index) };
}

export function addCounter(state: MappingState, counter: Counter): MappingState {
  if (state.counters.some((c) => c.metricKey === counter.metricKey)) return state;
  return { ...state, counters: [...state.counters, counter] };
}

export function removeCounter(state: MappingState, metricKey: string): MappingState {
  return { ...state, counters: state.counters.filter((c) => c.metricKey !== metricKey) };
}

/** Move an output column (drag and drop). */
export function moveColumn(state: MappingState, from: string, to: string): MappingState {
  const ordered = orderedOutput(state);
  const i = ordered.indexOf(from);
  const j = ordered.indexOf(to);
  if (i < 0 || j < 0 || i === j) return state;
  const next = [...ordered];
  next.splice(i, 1);
  next.splice(j, 0, from);
  return { ...state, order: next };
}

export function setBudgetSign(state: MappingState, budgetSign: BudgetSign): MappingState {
  return { ...state, budgetSign };
}

/** The header row picked by hand (0-based), saved with the template; undefined = detected. */
export function setHeaderRow(state: MappingState, headerRow: number | undefined): MappingState {
  if (state.headerRow === headerRow) return state;
  const next = { ...state };
  if (headerRow === undefined) delete next.headerRow;
  else next.headerRow = headerRow;
  return next;
}

/**
 * What leaving the "Rubrikraden står på rad" field picks: `typed` is the 1-based row the user
 * left in it, `shownRow` the 1-based row the table was read at, `picked` the 0-based row
 * picked so far. null = no change, so tabbing through the field never pins the detected row
 * in the template; an emptied field returns to automatic detection.
 */
export function headerRowFromInput(
  typed: string,
  shownRow: number | null,
  picked: number | undefined,
): { headerRow: number | undefined } | null {
  const text = typed.trim();
  if (text === "") return picked === undefined ? null : { headerRow: undefined };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) return null;
  const current = picked !== undefined ? picked + 1 : shownRow;
  return n === current ? null : { headerRow: n - 1 };
}

export function setCases(state: MappingState, patch: Partial<CasesForm>): MappingState {
  return { ...state, cases: { ...state.cases, ...patch } };
}
