import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { SlideSpecSchema, type SlideSpec } from "@/lib/contracts/slides";
import { catalogDefinitions } from "@/lib/metrics";
import { personalDimensionKeys, seededReportDimensions, type ReportDimension } from "./context";
import {
  COMPARE_CHOICES,
  NO_GROUP,
  filterSearchScore,
  filterSummary,
  filterableDimensions,
  fromCompareChoice,
  groupByChoices,
  metricChoices,
  previewHeadline,
  previewRequest,
  slideHints,
  slideLabel,
  toCompareChoice,
  usesGroupBy,
  usesTopN,
  validateReportSpec,
} from "./editor-options";
import {
  clearFilter,
  createSlide,
  duplicateSlide,
  insertSlide,
  moveSlide,
  moveSlideBy,
  neighbourAfterRemoval,
  newSlideId,
  parseTopN,
  patchSlide,
  removeSlide,
  specFingerprint,
  toggleFilterValue,
  withMetric,
} from "./spec-edit";

const DEFS = catalogDefinitions();
const def = (key: string): MetricDefinition => {
  const found = DEFS.find((d) => d.key === key);
  if (!found) throw new Error(key);
  return found;
};
const DIMS: ReportDimension[] = seededReportDimensions();

const slide = (input: Partial<z.input<typeof SlideSpecSchema>> = {}): SlideSpec =>
  SlideSpecSchema.parse({
    id: "s1",
    viz: "kpi",
    metricKey: "timmar",
    grain: "month",
    company: "ALL",
    ...input,
  });

describe("personal dimensions in editor options", () => {
  it("never offers konsult for breakdowns or filters", () => {
    const timmar = def("timmar");
    expect(timmar.dimensions).toContain("konsult");
    expect(filterableDimensions(timmar, DIMS).map((d) => d.key)).toEqual([
      "kund",
      "uppdrag",
      "verksamhet",
    ]);
    expect(groupByChoices(timmar, DIMS).map((c) => c.value)).toEqual([
      NO_GROUP,
      "bolag",
      "kund",
      "uppdrag",
      "verksamhet",
    ]);
  });

  it("also hides dimensions flagged personal in the catalog", () => {
    const dims = DIMS.map((d) => (d.key === "kund" ? { ...d, personal: true } : d));
    expect(personalDimensionKeys(dims)).toEqual(new Set(["konsult", "kund"]));
    expect(filterableDimensions(def("timmar"), dims).map((d) => d.key)).toEqual([
      "uppdrag",
      "verksamhet",
    ]);
  });

  it("hides konsult even when the catalog forgot to flag it", () => {
    const dims = DIMS.map((d) => ({ ...d, personal: false }));
    expect(filterableDimensions(def("timmar"), dims).map((d) => d.key)).not.toContain("konsult");
  });

  it("uses catalog labels and offers only the metric's dimensions", () => {
    expect(groupByChoices(def("aktiva_deltagare"), DIMS)).toEqual([
      { value: NO_GROUP, label: "Ingen" },
      { value: "bolag", label: "Bolag" },
      { value: "verksamhet", label: "Verksamhet" },
      { value: "ort", label: "Ort" },
      { value: "resultattyp", label: "Resultat" },
    ]);
    expect(filterableDimensions(undefined, DIMS)).toEqual([]);
    // Formula metrics get the intersection of their operands' dimensions.
    expect(filterableDimensions(def("faktor"), DIMS).map((d) => d.key)).toEqual([
      "kund",
      "uppdrag",
    ]);
  });
});

describe("choices", () => {
  it("maps comparisons to select values and back", () => {
    expect(COMPARE_CHOICES.map((c) => c.label)).toEqual([
      "Föregående period",
      "Samma period i fjol",
      "Budget",
      "Ingen",
    ]);
    expect(toCompareChoice(null)).toBe("none");
    expect(toCompareChoice("budget")).toBe("budget");
    expect(fromCompareChoice("none")).toBeNull();
    expect(fromCompareChoice("prev_year")).toBe("prev_year");
    expect(fromCompareChoice("anything")).toBeNull();
  });

  it("sorts metrics by Swedish name", () => {
    const names = metricChoices([
      { key: "o", name: "Övriga" },
      { key: "a", name: "Aktiva" },
      { key: "z", name: "Zebra" },
      { key: "aa", name: "Ändrat" },
    ]).map((c) => c.label);
    expect(names).toEqual(["Aktiva", "Zebra", "Ändrat", "Övriga"]);
  });

  it("knows which visualisations break down", () => {
    expect(usesGroupBy("bar")).toBe(true);
    expect(usesGroupBy("toplist")).toBe(true);
    expect(usesGroupBy("kpi")).toBe(false);
    expect(usesGroupBy("stacked_company")).toBe(false);
    expect(usesTopN("table")).toBe(true);
    expect(usesTopN("line")).toBe(false);
  });

  it("labels slides by headline override or metric name", () => {
    expect(slideLabel(slide(), def("timmar"))).toBe("Fakturerade timmar");
    expect(slideLabel(slide({ headline: "Timmarna rusar" }), def("timmar"))).toBe("Timmarna rusar");
    expect(slideLabel(slide({ headline: "  " }), undefined)).toBe("timmar");
  });

  it("previews without refetching for notes and headline edits", () => {
    const a = slide({ headline: "Timmarna rusar", notes: "Manus" });
    const b = slide({ headline: null, notes: "" });
    expect(previewRequest(a)).toEqual(b);
    expect(JSON.stringify(previewRequest(a))).toBe(JSON.stringify(previewRequest(b)));
    expect(previewHeadline(a, "TIMMARNA ÖKAR.")).toBe("TIMMARNA RUSAR.");
    expect(previewHeadline(b, "TIMMARNA ÖKAR.")).toBe("TIMMARNA ÖKAR.");
    expect(previewHeadline({ headline: "   " }, "X.")).toBe("X.");
  });

  it("summarises filter selections", () => {
    const values = [
      { id: 1, label: "KROM" },
      { id: 2, label: "ROM2" },
      { id: 3, label: "KVL" },
    ];
    expect(filterSummary([], values)).toBe("Alla");
    expect(filterSummary([2, 1], values)).toBe("ROM2, KROM");
    expect(filterSummary([1, 2, 3], values)).toBe("3 valda");
    expect(filterSummary([9], values)).toBe("Okänt värde");
  });

  it("searches filter values by label only, ignoring case", () => {
    expect(filterSearchScore("12", "krom", ["KROM"])).toBe(1);
    expect(filterSearchScore("12", "", ["KROM"])).toBe(1);
    expect(filterSearchScore("12", "rom2", ["KROM"])).toBe(0);
    expect(filterSearchScore("1", "rö", ["Örebro", "Rörstrand"])).toBe(1);
    expect(filterSearchScore("1", "ÖREB", ["Örebro"])).toBe(1);
    expect(filterSearchScore("3", "1", ["Kund A"])).toBe(0);
    expect(filterSearchScore("3", "volvo  ab", ["Volvo AB"])).toBe(1);
  });

  it("hints at combinations that render poorly", () => {
    expect(slideHints(slide())).toEqual([]);
    expect(slideHints(slide({ viz: "toplist" }))).toHaveLength(1);
    expect(slideHints(slide({ viz: "bar", groupBy: "bolag", company: "MBAB" }))).toHaveLength(1);
    expect(slideHints(slide({ viz: "stacked_company", company: "MBR" }))).toHaveLength(1);
    expect(slideHints(slide({ grain: "ytd" }))).toEqual([
      "Hittills i år jämförs med samma period i fjol.",
    ]);
  });
});

describe("validateReportSpec", () => {
  it("accepts a valid template", () => {
    const result = validateReportSpec({ name: "Styrelse", slides: [slide()] }, DIMS);
    expect(result).toEqual({ ok: true, spec: { name: "Styrelse", slides: [slide()] } });
  });

  it("refuses personal breakdowns and filters", () => {
    const grouped = validateReportSpec(
      { name: "X", slides: [slide(), slide({ id: "s2", viz: "bar", groupBy: "konsult" })] },
      DIMS,
    );
    expect(grouped).toEqual({
      ok: false,
      error: "Bild 2 får inte grupperas eller filtreras på personuppgifter (konsult).",
    });
    const filtered = validateReportSpec(
      { name: "X", slides: [slide({ filters: [{ dimension: "konsult", valueIds: [1] }] })] },
      DIMS,
    );
    expect(filtered.ok).toBe(false);
  });

  it("trims the name and refuses a blank one", () => {
    expect(validateReportSpec({ name: "  Styrelse  ", slides: [slide()] }, DIMS)).toEqual({
      ok: true,
      spec: { name: "Styrelse", slides: [slide()] },
    });
    expect(validateReportSpec({ name: "   ", slides: [] }, DIMS)).toEqual({
      ok: false,
      error: "Rapporten behöver ett namn (högst 120 tecken).",
    });
  });

  it("explains schema errors in Swedish", () => {
    expect(validateReportSpec({ name: "", slides: [] }, DIMS)).toEqual({
      ok: false,
      error: "Rapporten behöver ett namn (högst 120 tecken).",
    });
    expect(
      validateReportSpec(
        { name: "X", slides: [slide(), { ...slide(), id: "s2", headline: "x".repeat(81) }] },
        DIMS,
      ),
    ).toEqual({ ok: false, error: "Bild 2: rubriken är för lång (högst 80 tecken)." });
    expect(
      validateReportSpec({ name: "X", slides: [{ ...slide(), notes: "x".repeat(4001) }] }, DIMS),
    ).toEqual({
      ok: false,
      error: "Bild 1: talarmanuset är för långt (högst 4 000 tecken).",
    });
    expect(validateReportSpec({ name: "X", slides: [{ ...slide(), viz: "pie" }] }, DIMS)).toEqual({
      ok: false,
      error: "Bild 1: inställningarna är ogiltiga.",
    });
    expect(validateReportSpec(null, DIMS).ok).toBe(false);
  });

  it("refuses duplicate slide ids", () => {
    expect(validateReportSpec({ name: "X", slides: [slide(), slide()] }, DIMS)).toEqual({
      ok: false,
      error: "Två bilder har samma id.",
    });
  });
});

describe("spec editing", () => {
  const a = slide({ id: "a" });
  const b = slide({ id: "b", metricKey: "pass" });
  const c = slide({ id: "c", metricKey: "konsulter" });
  const ids = (slides: SlideSpec[]) => slides.map((s) => s.id);

  it("makes short ids that are not taken", () => {
    expect(newSlideId([], () => 0)).toBe("s-00000000");
    const draws = [0, 0, 0.5];
    const id = newSlideId([{ id: "s-00000000" }], () => draws.shift() ?? 0.9);
    expect(id).not.toBe("s-00000000");
    expect(id).toMatch(/^s-[0-9a-z]{8}$/);
  });

  it("creates a KPI slide with schema defaults", () => {
    expect(createSlide("n1")).toEqual(
      slide({ id: "n1", metricKey: "aktiva_deltagare", compare: "prev_period" }),
    );
  });

  it("inserts after a slide or at the end", () => {
    expect(ids(insertSlide([a, b], c, "a"))).toEqual(["a", "c", "b"]);
    expect(ids(insertSlide([a, b], c))).toEqual(["a", "b", "c"]);
    expect(ids(insertSlide([a, b], c, "missing"))).toEqual(["a", "b", "c"]);
  });

  it("duplicates right after the original with a new id and no shared state", () => {
    const withFilter = slide({ id: "a", filters: [{ dimension: "kund", valueIds: [1] }] });
    const result = duplicateSlide([withFilter, b], "a", "a2");
    expect(ids(result)).toEqual(["a", "a2", "b"]);
    expect(result[1]).toEqual({ ...withFilter, id: "a2" });
    expect(result[1]?.filters).not.toBe(withFilter.filters);
    expect(ids(duplicateSlide([a], "missing", "x"))).toEqual(["a"]);
  });

  it("removes and picks the neighbour to select", () => {
    expect(ids(removeSlide([a, b, c], "b"))).toEqual(["a", "c"]);
    expect(neighbourAfterRemoval([a, b, c], "b")).toBe("c");
    expect(neighbourAfterRemoval([a, b, c], "c")).toBe("b");
    expect(neighbourAfterRemoval([a], "a")).toBeNull();
    expect(neighbourAfterRemoval([a, b], "zz")).toBe("a");
  });

  it("reorders by drag target and by one step", () => {
    expect(ids(moveSlide([a, b, c], "a", "c"))).toEqual(["b", "c", "a"]);
    expect(ids(moveSlide([a, b, c], "c", "a"))).toEqual(["c", "a", "b"]);
    expect(ids(moveSlide([a, b, c], "a", "a"))).toEqual(["a", "b", "c"]);
    expect(ids(moveSlideBy([a, b, c], "b", -1))).toEqual(["b", "a", "c"]);
    expect(ids(moveSlideBy([a, b, c], "b", 1))).toEqual(["a", "c", "b"]);
    expect(ids(moveSlideBy([a, b, c], "a", -1))).toEqual(["a", "b", "c"]);
  });

  it("patches one slide", () => {
    const result = patchSlide([a, b], "b", { viz: "line", notes: "Hej" });
    expect(result[0]).toBe(a);
    expect(result[1]).toEqual({ ...b, viz: "line", notes: "Hej" });
  });

  it("drops breakdowns and filters the new metric does not have", () => {
    const s = slide({
      viz: "bar",
      groupBy: "kund",
      filters: [
        { dimension: "kund", valueIds: [1] },
        { dimension: "verksamhet", valueIds: [2] },
      ],
    });
    const switched = withMetric(s, def("aktiva_deltagare"), DIMS);
    expect(switched.metricKey).toBe("aktiva_deltagare");
    expect(switched.groupBy).toBeNull();
    expect(switched.filters).toEqual([{ dimension: "verksamhet", valueIds: [2] }]);
    expect(withMetric(slide({ groupBy: "bolag" }), def("resultat"), DIMS).groupBy).toBe("bolag");
    expect(withMetric(slide({ groupBy: "konsult" }), def("timmar"), DIMS).groupBy).toBeNull();
  });

  it("toggles filter values and removes empty filters", () => {
    let s = toggleFilterValue(slide(), "kund", 1);
    expect(s.filters).toEqual([{ dimension: "kund", valueIds: [1] }]);
    s = toggleFilterValue(s, "kund", 2);
    expect(s.filters).toEqual([{ dimension: "kund", valueIds: [1, 2] }]);
    s = toggleFilterValue(s, "verksamhet", 7);
    s = toggleFilterValue(s, "kund", 1);
    expect(s.filters).toEqual([
      { dimension: "kund", valueIds: [2] },
      { dimension: "verksamhet", valueIds: [7] },
    ]);
    s = toggleFilterValue(s, "kund", 2);
    expect(s.filters).toEqual([{ dimension: "verksamhet", valueIds: [7] }]);
    expect(clearFilter(s, "verksamhet").filters).toEqual([]);
  });

  it("parses Topp N", () => {
    expect(parseTopN("")).toBeNull();
    expect(parseTopN(" 8 ")).toBe(8);
    expect(parseTopN("0")).toBeUndefined();
    expect(parseTopN("-3")).toBeUndefined();
    expect(parseTopN("2,5")).toBeUndefined();
  });

  it("fingerprints equal specs equally", () => {
    expect(specFingerprint("R", [a, b])).toBe(specFingerprint("R", [{ ...a }, { ...b }]));
    expect(specFingerprint("R", patchSlide([a], "a", { notes: "x" }))).not.toBe(
      specFingerprint("R", [a]),
    );
  });
});
