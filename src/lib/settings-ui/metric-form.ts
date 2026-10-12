// State and validation of the metric form (edit an existing metric or create a formula metric).
import type { Unit } from "@/lib/contracts/domain";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { headlineSubjectOf } from "@/lib/metrics";
import {
  checkFormula,
  fromDirection,
  metricKeyError,
  toDirection,
  type Direction,
  type FormulaCheck,
} from "./metrics";
import type { MetricUpdateInput, NewFormulaMetricInput } from "./schemas";

export type MetricFormMode = "edit" | "create";

export interface MetricFormState {
  name: string;
  key: string;
  unit: Unit;
  description: string;
  direction: Direction;
  /** "" = the unit's default. */
  decimals: string;
  headlineSubject: string;
  formula: string;
}

/** Placeholder key used to check a new formula while the typed key is still invalid. */
const DRAFT_KEY = "nytt_formelmatt_utkast";

export function initialMetricForm(metric: MetricDefinition | null): MetricFormState {
  if (!metric) {
    return {
      name: "",
      key: "",
      unit: "kr",
      description: "",
      direction: "up",
      decimals: "0",
      headlineSubject: "",
      formula: "",
    };
  }
  return {
    name: metric.name,
    key: metric.key,
    unit: metric.unit,
    description: metric.description ?? "",
    direction: toDirection(metric.higherIsBetter),
    decimals: metric.decimals === null ? "" : String(metric.decimals),
    headlineSubject: metric.headlineSubject ?? "",
    formula: metric.formula ?? "",
  };
}

export interface MetricFormIssues {
  name: string | null;
  key: string | null;
  formula: FormulaCheck | null;
  valid: boolean;
}

export function metricFormIssues(
  state: MetricFormState,
  mode: MetricFormMode,
  definitions: readonly MetricDefinition[],
  isFormula: boolean,
): MetricFormIssues {
  const name = state.name.trim() === "" ? "Måttet måste ha ett namn." : null;
  const key =
    mode === "create"
      ? metricKeyError(
          state.key,
          definitions.map((d) => d.key),
        )
      : null;
  const checkKey = mode === "edit" ? state.key : key ? DRAFT_KEY : state.key;
  const formula = isFormula ? checkFormula(definitions, checkKey, state.formula) : null;
  return { name, key, formula, valid: !name && !key && (formula?.ok ?? true) };
}

/**
 * The formula errors to show: an empty formula in a fresh form is not shouted about until the
 * user submits (the save button still refuses it).
 */
export function shownFormulaErrors(
  issues: Pick<MetricFormIssues, "formula">,
  formula: string,
  submitted: boolean,
): string[] {
  const errors = issues.formula?.errors ?? [];
  return submitted || formula.trim() !== "" ? errors : [];
}

function decimalsOf(state: MetricFormState): number | null {
  return state.decimals === "" ? null : Number(state.decimals);
}

export function toUpdateInput(state: MetricFormState, isFormula: boolean): MetricUpdateInput {
  return {
    key: state.key,
    name: state.name,
    description: state.description,
    higherIsBetter: fromDirection(state.direction),
    decimals: decimalsOf(state),
    headlineSubject: state.headlineSubject,
    ...(isFormula ? { formula: state.formula } : {}),
  };
}

export function toCreateInput(state: MetricFormState): NewFormulaMetricInput {
  return {
    key: state.key,
    name: state.name,
    unit: state.unit,
    description: state.description,
    higherIsBetter: fromDirection(state.direction),
    decimals: decimalsOf(state),
    headlineSubject: state.headlineSubject,
    formula: state.formula,
  };
}

/** Example headline with the current subject: "FAKTORN ÖKAR." */
export function headlinePreview(state: Pick<MetricFormState, "name" | "headlineSubject">): string {
  const subject = headlineSubjectOf({
    name: state.name.trim() || "Måttet",
    headlineSubject: state.headlineSubject,
  });
  return `${subject} ÖKAR.`;
}
