import { describe, expect, it } from "vitest";
import { catalogDefinitions } from "@/lib/metrics";
import {
  headlinePreview,
  initialMetricForm,
  metricFormIssues,
  shownFormulaErrors,
  toCreateInput,
  toUpdateInput,
} from "./metric-form";
import { MetricUpdateSchema, NewFormulaMetricSchema } from "./schemas";

const defs = catalogDefinitions();
const faktor = defs.find((d) => d.key === "faktor")!;
const timmar = defs.find((d) => d.key === "timmar")!;

describe("metric form", () => {
  it("starts from the metric, or from sensible defaults for a new one", () => {
    expect(initialMetricForm(faktor)).toMatchObject({
      name: "Faktor",
      key: "faktor",
      direction: "up",
      decimals: "2",
      formula: "fakturerat_ip / (lonekostnad * 1.0)",
      headlineSubject: "FAKTORN",
    });
    expect(initialMetricForm(null)).toMatchObject({ key: "", unit: "kr", decimals: "0" });
  });

  it("validates an edit", () => {
    const state = initialMetricForm(faktor);
    expect(metricFormIssues(state, "edit", defs, true).valid).toBe(true);
    const broken = metricFormIssues(
      { ...state, formula: "faktor * 2", name: " " },
      "edit",
      defs,
      true,
    );
    expect(broken.valid).toBe(false);
    expect(broken.name).toBe("Måttet måste ha ett namn.");
    expect(broken.formula?.errors[0]).toMatch(/sig själv/);
    expect(metricFormIssues(initialMetricForm(timmar), "edit", defs, false).formula).toBeNull();
  });

  it("validates a new formula metric, including its key", () => {
    const base = {
      ...initialMetricForm(null),
      name: "Intäkt per konsult",
      formula: "fakturerat_ip / konsulter",
    };
    expect(
      metricFormIssues({ ...base, key: "intakt_per_konsult_2" }, "create", defs, true).valid,
    ).toBe(true);
    const taken = metricFormIssues({ ...base, key: "timmar" }, "create", defs, true);
    expect(taken.key).toMatch(/finns redan/);
    // The formula is still checked (under a draft key) while the key is invalid.
    expect(taken.formula?.ok).toBe(true);
    expect(
      metricFormIssues({ ...base, key: "ok_key", formula: "" }, "create", defs, true).valid,
    ).toBe(false);
  });

  it("waits with the empty-formula error until the form is submitted", () => {
    const fresh = initialMetricForm(null);
    const issues = metricFormIssues(fresh, "create", defs, true);
    expect(issues.valid).toBe(false);
    expect(shownFormulaErrors(issues, fresh.formula, false)).toEqual([]);
    expect(shownFormulaErrors(issues, fresh.formula, true)).toEqual(["Skriv en formel."]);
    const typed = { ...fresh, formula: "timmar /" };
    expect(
      shownFormulaErrors(metricFormIssues(typed, "create", defs, true), typed.formula, false),
    ).toHaveLength(1);
  });

  it("builds inputs the action schemas accept", () => {
    const edit = toUpdateInput({ ...initialMetricForm(faktor), decimals: "" }, true);
    expect(MetricUpdateSchema.parse(edit)).toMatchObject({
      key: "faktor",
      decimals: null,
      formula: faktor.formula,
    });
    expect("formula" in toUpdateInput(initialMetricForm(timmar), false)).toBe(false);
    const create = toCreateInput({
      ...initialMetricForm(null),
      key: "ny_kvot",
      name: "Ny kvot",
      direction: "neutral",
      formula: "timmar / pass",
    });
    expect(NewFormulaMetricSchema.parse(create)).toMatchObject({
      key: "ny_kvot",
      unit: "kr",
      higherIsBetter: null,
      decimals: 0,
      description: null,
      headlineSubject: null,
    });
  });

  it("previews the headline", () => {
    expect(headlinePreview({ name: "Faktor", headlineSubject: "faktorn" })).toBe("FAKTORN ÖKAR.");
    expect(headlinePreview({ name: "Intäkt per konsult", headlineSubject: "" })).toBe(
      "INTÄKT PER KONSULT ÖKAR.",
    );
    expect(headlinePreview({ name: "", headlineSubject: "" })).toBe("MÅTTET ÖKAR.");
  });
});
