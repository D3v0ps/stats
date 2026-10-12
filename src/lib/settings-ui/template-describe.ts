// An import template version in readable Swedish: the steps, what each column is used
// for and how period, company and scenario are decided. Server-side only (it pulls in the
// ingest module for STEP_LABELS).
import {
  COLUMN_TYPE_LABELS,
  COLUMN_USAGE_LABELS,
  type CasesConfig,
  type Step,
  type TemplateConfig,
} from "@/lib/contracts/pipeline";
import { COMPANY_FILTER_LABELS } from "@/lib/contracts/domain";
import { formatMonthLong } from "@/lib/core/month";
import { STEP_LABELS } from "@/lib/ingest";

export interface DescribeContext {
  metricNames: Readonly<Record<string, string>>;
  dimensionLabels: Readonly<Record<string, string>>;
}

export interface DescribedStep {
  label: string;
  detail: string;
}

export interface DescribedColumn {
  column: string;
  usage: string;
  type: string;
  /** Metric or dimension the column feeds, if any. */
  target: string | null;
  removed: boolean;
  personal: boolean;
}

export interface TemplateDescription {
  kindLabel: string;
  steps: DescribedStep[];
  columns: DescribedColumn[];
  /** Label/value pairs: period, company, scenario, counters, cases or SIE settings. */
  settings: { label: string; value: string }[];
}

export const TEMPLATE_KIND_LABELS: Record<TemplateConfig["kind"], string> = {
  table: "Tabell (en rad per post)",
  cases: "Ärenden (start- och slutdatum)",
  sie: "Bokföring (SIE)",
};

const q = (text: string) => `”${text}”`;
const list = (items: readonly string[]) => items.map(q).join(", ");

function separator(sep: string): string {
  if (sep === "") return "utan avgränsare";
  if (sep === " ") return "med mellanslag";
  return `med ${q(sep)}`;
}

const CLEAN_LABELS: Record<Extract<Step, { op: "clean" }>["as"], string> = {
  number: "tal",
  amount: "belopp",
  hours: "timmar",
  percent: "procent",
  trim: "text (tar bort extra mellanslag)",
};

export function describeStep(step: Step, ctx: DescribeContext): DescribedStep {
  const label = STEP_LABELS[step.op];
  const dim = (key: string) => ctx.dimensionLabels[key] ?? key;
  switch (step.op) {
    case "rename":
      return { label, detail: `${q(step.column)} heter nu ${q(step.to)}` };
    case "drop":
      return { label, detail: `Kolumnen ${q(step.column)} tas bort` };
    case "merge":
      return {
        label,
        detail: `${list(step.columns)} slås ihop ${separator(step.separator)} till ${q(step.into)}`,
      };
    case "split": {
      const how =
        step.mode === "year_month"
          ? "i år och månad"
          : step.mode === "last_first"
            ? "från ”Efternamn, Förnamn”"
            : separator(step.delimiter ?? "").replace(/^med/, "vid");
      return { label, detail: `${q(step.column)} delas ${how} till ${list(step.into)}` };
    }
    case "replace": {
      const where = step.match === "whole_cell" ? "hela cellen" : "delar av cellen";
      const caseNote = step.caseSensitive ? ", skiftlägeskänsligt" : "";
      const replacement = step.replace === "" ? "(tomt)" : q(step.replace);
      return {
        label,
        detail: `${q(step.find)} blir ${replacement} i ${q(step.column)} (${where}${caseNote})`,
      };
    }
    case "clean":
      return { label, detail: `${q(step.column)} läses som ${CLEAN_LABELS[step.as]}` };
    case "lookup":
      return {
        label,
        detail: `${q(step.column)} översätts med uppslagen för ${q(dim(step.dimension))}`,
      };
    case "filter": {
      const value = q(step.value ?? "");
      const condition = {
        equals: `är ${value}`,
        not_equals: `inte är ${value}`,
        contains: `innehåller ${value}`,
        empty: "är tom",
        not_empty: "inte är tom",
      }[step.operator];
      return { label, detail: `Rader där ${q(step.column)} ${condition} tas bort` };
    }
    case "reorder":
      return { label, detail: `Ordning: ${list(step.order)}` };
    case "unpivot":
      return {
        label,
        detail: `${list(step.columns)} blir rader med rubriken i ${q(step.nameColumn)} och värdet i ${q(step.valueColumn)}`,
      };
    case "fill_down":
      return { label, detail: `Tomma celler i ${q(step.column)} får värdet ovanför` };
    case "negate":
      return { label, detail: `Talen i ${q(step.column)} byter tecken` };
    case "constant":
      return { label, detail: `Ny kolumn ${q(step.column)} med värdet ${q(step.value)}` };
  }
}

function companyText(config: Exclude<TemplateConfig, { kind: "sie" }>): string {
  const source = config.company;
  switch (source.kind) {
    case "fixed":
      return COMPANY_FILTER_LABELS[source.company];
    case "per_upload":
      return "Väljs vid uppladdning";
    case "column": {
      const mapping = Object.entries(source.mapping)
        .map(([raw, code]) => `${q(raw)} = ${COMPANY_FILTER_LABELS[code]}`)
        .join(", ");
      return `Kolumnen ${q(source.column)}${mapping ? ` (${mapping})` : ""}`;
    }
  }
}

const CASE_METRIC_LABELS: Record<keyof CasesConfig["metrics"], string> = {
  active: "Aktiva vid månadens slut",
  started: "Startade",
  ended: "Avslutade",
  interrupted: "Avbrott",
  results: "Resultat",
  tenureMonths: "Genomsnittlig tid",
};

function casesSettings(cases: CasesConfig, ctx: DescribeContext) {
  const out: { label: string; value: string }[] = [];
  const column = (c: string | undefined) => (c ? q(c) : "–");
  out.push({ label: "Startdatum", value: column(cases.startColumn) });
  if (cases.endColumn) out.push({ label: "Slutdatum", value: column(cases.endColumn) });
  if (cases.keyColumn) {
    out.push({ label: "Id (räknas, sparas inte)", value: column(cases.keyColumn) });
  }
  if (cases.interruptColumn) {
    out.push({ label: "Avbrott", value: column(cases.interruptColumn) });
  }
  if (cases.resultColumn) out.push({ label: "Resultat", value: column(cases.resultColumn) });
  const results = Object.entries(cases.resultMap);
  if (results.length > 0) {
    out.push({
      label: "Resultatvärden",
      value: results.map(([raw, label]) => `${q(raw)} = ${label}`).join(", "),
    });
  }
  if (cases.groupBy.length > 0) out.push({ label: "Grupperas på", value: list(cases.groupBy) });
  const produced = (Object.entries(cases.metrics) as [keyof CasesConfig["metrics"], string][])
    .filter(([, key]) => key)
    .map(([role, key]) => `${CASE_METRIC_LABELS[role]} → ${ctx.metricNames[key] ?? key}`);
  if (produced.length > 0) out.push({ label: "Mått", value: produced.join(", ") });
  if (cases.fromMonth) out.push({ label: "Första månad", value: formatMonthLong(cases.fromMonth) });
  return out;
}

export function describeTemplate(
  config: TemplateConfig,
  ctx: DescribeContext,
): TemplateDescription {
  const kindLabel = TEMPLATE_KIND_LABELS[config.kind];
  if (config.kind === "sie") {
    const dims = config.objectDims
      .map((n) => (n === 1 ? "1 (kostnadsställe)" : n === 6 ? "6 (projekt)" : String(n)))
      .join(", ");
    return {
      kindLabel,
      steps: [],
      columns: [],
      settings: [
        { label: "Bolag", value: "Läses från organisationsnumret i filen" },
        { label: "Objekt som sparas", value: dims ? `Dimension ${dims}` : "Inga" },
      ],
    };
  }

  const columns: DescribedColumn[] = config.columns.map((c) => ({
    column: c.column,
    usage: COLUMN_USAGE_LABELS[c.usage],
    type: COLUMN_TYPE_LABELS[c.type],
    target:
      c.usage === "measure" && c.metricKey
        ? (ctx.metricNames[c.metricKey] ?? c.metricKey)
        : c.usage === "dimension" && c.dimensionKey
          ? (ctx.dimensionLabels[c.dimensionKey] ?? c.dimensionKey)
          : null,
    removed: !c.keep || c.usage === "ignore",
    personal: c.personal,
  }));

  const settings: { label: string; value: string }[] = [];
  if (config.kind === "table") {
    settings.push({
      label: "Period",
      value:
        config.period.kind === "column"
          ? `Kolumnen ${q(config.period.column)}`
          : "Väljs vid uppladdning (hela filen är en månad)",
    });
  }
  settings.push({ label: "Bolag", value: companyText(config) });
  if (config.kind === "table") {
    settings.push({ label: "Scenario", value: config.scenario === "budget" ? "Budget" : "Utfall" });
    if (config.counters.length > 0) {
      settings.push({
        label: "Räknar rader",
        value: config.counters.map((c) => ctx.metricNames[c.metricKey] ?? c.metricKey).join(", "),
      });
    }
  } else {
    settings.push(...casesSettings(config.cases, ctx));
  }

  return {
    kindLabel,
    steps: config.steps.map((s) => describeStep(s, ctx)),
    columns,
    settings,
  };
}

/** "timmar, kund, konsult + 4 till" for the template list. */
export function signatureSummary(signature: readonly string[], shown = 4): string {
  if (signature.length === 0) return "–";
  const head = signature.slice(0, shown).join(", ");
  const rest = signature.length - shown;
  return rest > 0 ? `${head} + ${rest} till` : head;
}
