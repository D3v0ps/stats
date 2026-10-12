import { describe, expect, it } from "vitest";
import type { ColumnMapping, Step } from "@/lib/contracts";
import { applySteps } from "@/lib/ingest/pipeline";
import type { WorkingTable } from "@/lib/ingest/working";
import {
  addCounter,
  addStep,
  companyChoice,
  defaultCaseMetrics,
  fromTemplateConfig,
  hasBlockingProblems,
  headerRowFromInput,
  initialMapping,
  mappingSteps,
  migrateCaseMetrics,
  moveColumn,
  orderedOutput,
  removeCounter,
  removeStep,
  renameSource,
  setBudgetSign,
  setCases,
  setCompanyChoice,
  setCompanyMapping,
  setDataset,
  setField,
  setHeaderRow,
  setKeep,
  setPeriodColumn,
  simulateColumns,
  toTemplateConfig,
  toolOutput,
  usagesFor,
  validateMapping,
  defaultColumnFor,
  type MappingState,
  type SourceColumnInfo,
} from "./mapping";
import { SEED_CATALOG } from "./test-fixtures";

const src = (name: string, extra: Partial<SourceColumnInfo> = {}): SourceColumnInfo => ({
  name,
  header: name.toUpperCase(),
  samples: [],
  inferredType: "text",
  personal: false,
  locked: false,
  ...extra,
});

const SOURCES = [
  src("kund"),
  src("datum", { inferredType: "date" }),
  src("anställnings id"),
  src("namn", { personal: true }),
  src("personnummer", { personal: true, locked: true }),
  src("timmar", { inferredType: "hours" }),
];

const SUGGESTIONS: ColumnMapping[] = [
  {
    column: "kund",
    type: "text",
    usage: "dimension",
    dimensionKey: "kund",
    personal: false,
    keep: true,
  },
  { column: "datum", type: "date", usage: "period", personal: false, keep: true },
  {
    column: "anställnings id",
    type: "text",
    usage: "dimension",
    dimensionKey: "konsult",
    personal: false,
    keep: true,
  },
  { column: "namn", type: "text", usage: "ignore", personal: true, keep: false },
  { column: "personnummer", type: "text", usage: "ignore", personal: true, keep: false },
  {
    column: "timmar",
    type: "hours",
    usage: "measure",
    metricKey: "timmar",
    personal: false,
    keep: true,
  },
];

function timmar(): MappingState {
  return initialMapping(SOURCES, SUGGESTIONS, {
    datasetKey: "ip_timmar",
    templateName: "Timmar",
    catalog: SEED_CATALOG,
  });
}

describe("initialMapping", () => {
  it("starts with personal columns removed and personnummer locked", () => {
    const s = timmar();
    expect(s.sources.map((x) => [x.name, x.keep, x.personal, x.locked])).toEqual([
      ["kund", true, false, false],
      ["datum", true, false, false],
      ["anställnings id", true, false, false],
      ["namn", false, true, false],
      ["personnummer", false, true, true],
      ["timmar", true, false, false],
    ]);
    expect(s.fields.timmar).toEqual({ type: "hours", usage: "measure", metricKey: "timmar" });
    expect(hasBlockingProblems(validateMapping(s, SEED_CATALOG))).toBe(false);
  });

  it("drops removed columns first, then renames, then tools", () => {
    let s = renameSource(timmar(), "anställnings id", "anstid");
    s = addStep(s, { op: "filter", column: "anstid", operator: "empty", caseSensitive: false });
    expect(mappingSteps(s)).toEqual([
      { op: "drop", column: "namn" },
      { op: "drop", column: "personnummer" },
      { op: "rename", column: "anställnings id", to: "anstid" },
      { op: "filter", column: "anstid", operator: "empty", caseSensitive: false },
    ]);
  });
});

describe("edits", () => {
  it("never keeps a personnummer column", () => {
    const s = timmar();
    expect(setKeep(s, "personnummer", true)).toBe(s);
    const kept = setKeep(s, "namn", true);
    expect(kept.sources.find((x) => x.name === "namn")?.keep).toBe(true);
    expect(mappingSteps(kept)[0]).toEqual({ op: "drop", column: "personnummer" });
  });

  it("renames every reference to a column", () => {
    let s = addStep(timmar(), { op: "clean", column: "timmar", as: "hours" });
    s = { ...s, order: ["timmar", "kund"] };
    s = renameSource(s, "timmar", "tid");
    expect(s.fields.tid?.metricKey).toBe("timmar");
    expect(s.fields.timmar).toBeUndefined();
    expect(s.tools).toEqual([{ op: "clean", column: "tid", as: "hours" }]);
    expect(s.order).toEqual(["tid", "kund"]);
    expect(toolOutput(s).columns).toContain("tid");
  });

  it("moves single-use usages to the new column", () => {
    let s = setField(timmar(), "kund", { usage: "period" });
    expect(s.fields.kund?.usage).toBe("period");
    expect(s.fields.datum?.usage).toBe("ignore");
    expect(s.fields.kund?.dimensionKey).toBeUndefined();
    s = setPeriodColumn(s, null);
    expect(Object.values(s.fields).some((f) => f.usage === "period")).toBe(false);
    s = setPeriodColumn(s, "datum");
    expect(s.fields.datum).toMatchObject({ usage: "period", type: "date" });
  });

  it("handles the company choice", () => {
    let s = setCompanyChoice(timmar(), { kind: "fixed", company: "MBR" });
    expect(companyChoice(s)).toEqual({ kind: "fixed", company: "MBR" });
    s = setCompanyChoice(s, { kind: "column", column: "kund" });
    expect(companyChoice(s)).toEqual({ kind: "column", column: "kund" });
    s = setCompanyMapping(s, "Restart", "MBR");
    s = setCompanyMapping(setCompanyMapping(s, "X", "MBAB"), "X", null);
    expect(toTemplateConfig(s, SEED_CATALOG)).toMatchObject({
      company: { kind: "column", column: "kund", mapping: { Restart: "MBR" } },
    });
    s = setCompanyChoice(s, { kind: "per_upload" });
    expect(s.fields.kund?.usage).toBe("ignore");
    expect(toTemplateConfig(s, SEED_CATALOG)).toMatchObject({ company: { kind: "per_upload" } });
  });

  it("adds and removes steps and counters", () => {
    let s = addStep(timmar(), { op: "fill_down", column: "kund" });
    s = addStep(s, { op: "negate", column: "timmar" });
    s = removeStep(s, 0);
    expect(s.tools).toEqual([{ op: "negate", column: "timmar" }]);
    expect(removeStep(s, 5)).toBe(s);
    s = addCounter(s, { metricKey: "pass", kind: "count_rows" });
    expect(addCounter(s, { metricKey: "pass", kind: "count_rows" })).toBe(s);
    expect(removeCounter(s, "pass").counters).toEqual([]);
  });

  it("reorders columns with a trailing reorder step", () => {
    const s = moveColumn(timmar(), "timmar", "kund");
    expect(orderedOutput(s)).toEqual(["timmar", "kund", "datum", "anställnings id"]);
    expect(mappingSteps(s).at(-1)).toEqual({ op: "reorder", order: ["timmar"] });
    expect(moveColumn(s, "nope", "kund")).toBe(s);
  });

  it("re-suggests on a dataset change and drops metrics of other datasets", () => {
    const s = setDataset(timmar(), "ip_franvaro", SEED_CATALOG, [
      {
        column: "timmar",
        type: "hours",
        usage: "measure",
        metricKey: "sjuktimmar",
        personal: false,
        keep: true,
      },
    ]);
    expect(s.fields.timmar?.metricKey).toBe("sjuktimmar");
    expect(s.templateName).toBe("Timmar");
    const unnamed = setDataset({ ...timmar(), templateName: "" }, "ip_franvaro", SEED_CATALOG);
    expect(unnamed.templateName).toBe("Intelliplan – frånvaro");
    expect(unnamed.fields.timmar?.metricKey).toBeUndefined();
    expect(unnamed.fields["anställnings id"]?.dimensionKey).toBe("konsult");
  });

  it("names the template after the sheet in a multi-sheet workbook", () => {
    const fresh = { ...timmar(), datasetKey: null, templateName: "" };
    const s = setDataset(fresh, "budget", SEED_CATALOG, undefined, "MB Restart");
    expect(s.templateName).toBe("Budget – MB Restart");
    // The default name follows a dataset change; a name the user typed stays.
    expect(setDataset(s, "ip_timmar", SEED_CATALOG, undefined, "MB Restart").templateName).toBe(
      "Intelliplan – timmar och pass – MB Restart",
    );
    const typed = setDataset({ ...s, templateName: "Min budget" }, "ip_timmar", SEED_CATALOG);
    expect(typed.templateName).toBe("Min budget");
  });
});

describe("defaultColumnFor", () => {
  it("does not take over a column that is already mapped", () => {
    // kund is a dimension, datum the period, timmar a measure: nothing is free.
    let s = timmar();
    expect(defaultColumnFor(s, toolOutput(s).columns, "period")).toBe("datum");
    expect(defaultColumnFor(s, toolOutput(s).columns, "company")).toBe("kund");
    s = addStep(s, { op: "constant", column: "bolag", value: "MB AB" });
    s = addStep(s, { op: "constant", column: "status", value: "x" });
    const outputs = toolOutput(s).columns;
    expect(defaultColumnFor(s, outputs, "company")).toBe("bolag");
    s = setField(s, "bolag", { usage: "dimension", dimensionKey: "verksamhet" });
    expect(defaultColumnFor(s, outputs, "company")).toBe("status");
  });

  it("prefers a free date column for the period", () => {
    let s = setPeriodColumn(timmar(), null);
    s = addStep(s, { op: "constant", column: "bokföringsdag", value: "2026-09-30" });
    s = setField(s, "bokföringsdag", { type: "date" });
    s = setField(s, "datum", { usage: "dimension", dimensionKey: "uppdrag" });
    expect(defaultColumnFor(s, toolOutput(s).columns, "period")).toBe("bokföringsdag");
  });
});

describe("validation", () => {
  const messages = (s: MappingState) => validateMapping(s, SEED_CATALOG).map((p) => p.message);

  it("asks for a dataset, a name and something to count", () => {
    const s = initialMapping(SOURCES, [], {
      datasetKey: null,
      templateName: "",
      catalog: SEED_CATALOG,
    });
    expect(messages(s)).toEqual(["Välj vilken rapport det här är.", "Ge mallen ett namn."]);
    const ds = setDataset({ ...s, templateName: "x" }, "ip_timmar", SEED_CATALOG);
    expect(messages(ds)).toContain(
      "Välj minst en kolumn som ”Siffra att räkna på”, eller lägg till ”Räkna rader”.",
    );
  });

  it("explains missing metrics and dimensions, duplicates and wrong datasets", () => {
    let s = setField(timmar(), "timmar", { metricKey: undefined });
    expect(messages(s)).toContain("Kolumnen ”timmar”: välj vilket mått siffrorna hör till.");
    s = setField(timmar(), "kund", { dimensionKey: "konsult" });
    expect(messages(s)).toContain("Konsult är vald för både ”kund” och ”anställnings id”.");
    s = setField(timmar(), "kund", { dimensionKey: "kontogrupp" });
    expect(messages(s)).toContain(
      "Kolumnen ”kund”: Kontogrupp går inte att gruppera på i Intelliplan – timmar och pass.",
    );
    s = setField(timmar(), "kund", { usage: "measure", metricKey: "timmar" });
    expect(messages(s)).toContain("Samma mått är valt för både ”kund” och ”timmar”.");
    s = setField(timmar(), "timmar", { metricKey: "sjuktimmar" });
    expect(messages(s)).toContain(
      "Kolumnen ”timmar”: måttet hör inte till Intelliplan – timmar och pass.",
    );
    s = setField(timmar(), "kund", { usage: "case_start" });
    expect(messages(s)).toContain(
      "Kolumnen ”kund”: ”Startdatum” används bara i deltagar- och anställningslistor.",
    );
  });

  it("reports broken steps and name clashes in user terms", () => {
    let s = addStep(timmar(), {
      op: "filter",
      column: "namn",
      operator: "empty",
      caseSensitive: false,
    });
    expect(messages(s)).toContain(
      "Steg 1 (Filtrera bort rader) använder kolumnen ”namn”, som inte finns.",
    );
    s = renameSource(timmar(), "kund", "datum");
    expect(messages(s)).toContain("Kolumnen ”kund” kan inte heta ”datum”, namnet används redan.");
    s = renameSource(timmar(), "kund", " kund ");
    expect(messages(s)).toContain("Namnet ” kund ” får inte börja eller sluta med mellanslag.");
    s = addStep(timmar(), { op: "constant", column: "kund", value: "x" });
    expect(messages(s)).toContain(
      "Steg 1 (Fast värde) skapar kolumnen ”kund”, men namnet används redan.",
    );
  });

  it("advises on kept personal columns", () => {
    let s = setKeep(timmar(), "namn", true);
    s = setField(s, "namn", { usage: "dimension", dimensionKey: "verksamhet" });
    const p = validateMapping(s, SEED_CATALOG).find((x) => x.message.includes("personuppgifter"));
    expect(p).toMatchObject({ blocking: false });
  });
});

describe("budget sign", () => {
  const budget = () =>
    initialMapping(
      [
        src("post"),
        src("period", { inferredType: "date" }),
        src("belopp", { inferredType: "amount" }),
      ],
      [
        {
          column: "post",
          type: "text",
          usage: "dimension",
          dimensionKey: "kontogrupp",
          personal: false,
          keep: true,
        },
        { column: "period", type: "date", usage: "period", personal: false, keep: true },
        {
          column: "belopp",
          type: "amount",
          usage: "measure",
          metricKey: "budget_belopp",
          personal: false,
          keep: true,
        },
      ],
      { datasetKey: "budget", templateName: "Budget", catalog: SEED_CATALOG },
    );

  const COLS = [src("post"), src("period"), src("belopp")];
  const reopen = (config: ReturnType<typeof toTemplateConfig>) =>
    fromTemplateConfig(config, COLS, {
      datasetKey: "budget",
      templateName: "Budget",
      catalog: SEED_CATALOG,
    });

  it("saves the sign as the template's budgetSign, never as a step", () => {
    const config = toTemplateConfig(budget(), SEED_CATALOG);
    expect(config).toMatchObject({ kind: "table", scenario: "budget", budgetSign: "result" });
    expect(config.kind === "table" && config.steps).toEqual([]);
    for (const sign of ["positive", "ledger"] as const) {
      const other = toTemplateConfig(setBudgetSign(budget(), sign), SEED_CATALOG);
      expect(other).toMatchObject({ budgetSign: sign, steps: [] });
    }
    // Other datasets have no budget sign.
    expect(toTemplateConfig(timmar(), SEED_CATALOG)).not.toHaveProperty("budgetSign");
  });

  it("opens the sign again from the template", () => {
    for (const sign of ["result", "positive", "ledger"] as const) {
      const back = reopen(toTemplateConfig(setBudgetSign(budget(), sign), SEED_CATALOG));
      expect(back.budgetSign).toBe(sign);
      expect(back.tools).toEqual([]);
    }
  });

  it("migrates a legacy trailing negate step to budgetSign result", () => {
    const current = toTemplateConfig(budget(), SEED_CATALOG);
    if (current.kind !== "table") throw new Error("table expected");
    const { budgetSign: _sign, ...rest } = current;
    expect(_sign).toBe("result");
    const legacy = {
      ...rest,
      steps: [
        { op: "fill_down" as const, column: "post" },
        { op: "negate" as const, column: "belopp" },
      ],
    };
    const back = reopen(legacy);
    expect(back.budgetSign).toBe("result");
    expect(back.tools).toEqual([{ op: "fill_down", column: "post" }]);
    expect(toTemplateConfig(back, SEED_CATALOG)).toMatchObject({
      budgetSign: "result",
      steps: [{ op: "fill_down", column: "post" }],
    });
    // Without a sign step (and no budgetSign) the amounts were stored as they are.
    expect(reopen({ ...rest, steps: [] }).budgetSign).toBe("ledger");
    // A negate that a later step reads is a tool of its own.
    const read = reopen({
      ...rest,
      steps: [
        { op: "negate", column: "belopp" },
        { op: "filter", column: "belopp", operator: "empty", caseSensitive: false },
      ],
    });
    expect(read.budgetSign).toBe("ledger");
    expect(read.tools).toHaveLength(2);
    // With budgetSign set, a negate step is the user's own tool.
    const both = reopen({ ...current, steps: [{ op: "negate", column: "belopp" }] });
    expect(both.budgetSign).toBe("result");
    expect(both.tools).toEqual([{ op: "negate", column: "belopp" }]);
  });

  it("needs a kontogrupp column when every amount is positive", () => {
    const messages = (s: MappingState) => validateMapping(s, SEED_CATALOG).map((p) => p.message);
    const positive = setBudgetSign(budget(), "positive");
    expect(hasBlockingProblems(validateMapping(positive, SEED_CATALOG))).toBe(false);
    expect(messages(setField(positive, "post", { usage: "ignore" }))).toContain(
      "Med ”Alla belopp positiva” tas tecknet från kontogruppen: välj kolumnen som grupperas på Kontogrupp.",
    );
  });
});

describe("header row", () => {
  it("saves a header row picked by hand and opens it again", () => {
    const s = setHeaderRow(timmar(), 4);
    expect(setHeaderRow(s, 4)).toBe(s);
    const config = toTemplateConfig(s, SEED_CATALOG);
    expect(config).toMatchObject({ headerRow: 4 });
    const back = fromTemplateConfig(config, SOURCES, {
      datasetKey: "ip_timmar",
      templateName: "Timmar",
      catalog: SEED_CATALOG,
    });
    expect(back.headerRow).toBe(4);
    expect(toTemplateConfig(back, SEED_CATALOG)).toEqual(config);
    const cleared = setHeaderRow(back, undefined);
    expect(cleared).not.toHaveProperty("headerRow");
    expect(toTemplateConfig(cleared, SEED_CATALOG)).not.toHaveProperty("headerRow");
    expect(toTemplateConfig(timmar(), SEED_CATALOG)).not.toHaveProperty("headerRow");
  });

  it("takes a row from the field only when the user changes it", () => {
    // Detected at row 4 (1-based), nothing picked: leaving the field as it is pins nothing.
    expect(headerRowFromInput("4", 4, undefined)).toBeNull();
    expect(headerRowFromInput(" 4 ", 4, undefined)).toBeNull();
    expect(headerRowFromInput("6", 4, undefined)).toEqual({ headerRow: 5 });
    // Picked row 6 (0-based 5): the same row again changes nothing, another row replaces it.
    expect(headerRowFromInput("6", 6, 5)).toBeNull();
    expect(headerRowFromInput("3", 6, 5)).toEqual({ headerRow: 2 });
    // An emptied field goes back to automatic detection.
    expect(headerRowFromInput("", 6, 5)).toEqual({ headerRow: undefined });
    expect(headerRowFromInput("  ", 4, undefined)).toBeNull();
    // Not a row number: ignored.
    for (const typed of ["0", "-2", "2.5", "x"]) {
      expect(headerRowFromInput(typed, 4, undefined)).toBeNull();
    }
  });
});

describe("cases datasets", () => {
  const SRC = [
    src("gen-nummer"),
    src("namn", { personal: true }),
    src("ort"),
    src("startdatum", { inferredType: "date" }),
    src("slutdatum", { inferredType: "date" }),
    src("resultat"),
  ];

  function cases(): MappingState {
    let s = initialMapping(SRC, [], {
      datasetKey: "wb_deltagare",
      templateName: "Deltagare",
      catalog: SEED_CATALOG,
    });
    s = setField(s, "gen-nummer", { usage: "case_key" });
    s = setField(s, "startdatum", { usage: "case_start" });
    s = setField(s, "slutdatum", { usage: "case_end" });
    s = setField(s, "resultat", { usage: "case_result" });
    s = setField(s, "ort", { usage: "dimension", dimensionKey: "ort" });
    return setCases(s, { fromMonth: "2025-01" });
  }

  it("offers case usages and default measures", () => {
    expect(usagesFor("cases")).toContain("case_start");
    expect(usagesFor("cases")).not.toContain("measure");
    expect(usagesFor("table")).not.toContain("case_start");
    expect(defaultCaseMetrics(SEED_CATALOG, "ip_konsulter")).toEqual({
      active: "anstallda_konsulter",
      started: "nyanstallda",
      ended: "avslutade_anstallningar",
      tenureMonthsSum: "anstallningsmanader",
    });
    expect(defaultCaseMetrics(SEED_CATALOG, "budget")).toEqual({});
  });

  it("replaces the deprecated tenure average with the tenure sum", () => {
    const old = { active: "anstallda_konsulter", tenureMonths: "anstallningstid" };
    expect(migrateCaseMetrics(old, SEED_CATALOG, "ip_konsulter")).toEqual({
      active: "anstallda_konsulter",
      tenureMonthsSum: "anstallningsmanader",
    });
    expect(
      migrateCaseMetrics(
        { ...old, tenureMonthsSum: "anstallningsmanader" },
        SEED_CATALOG,
        "ip_konsulter",
      ),
    ).toEqual({ active: "anstallda_konsulter", tenureMonthsSum: "anstallningsmanader" });
    // A dataset without a tenure sum just loses the average.
    expect(migrateCaseMetrics(old, SEED_CATALOG, "wb_deltagare")).toEqual({
      active: "anstallda_konsulter",
    });
    const unchanged = { active: "aktiva_deltagare" };
    expect(migrateCaseMetrics(unchanged, SEED_CATALOG, "wb_deltagare")).toEqual(unchanged);
  });

  it("opens a template with the deprecated tenure average as one with the tenure sum", () => {
    const config = toTemplateConfig(
      setCases(
        setField(
          initialMapping(SRC, [], {
            datasetKey: "ip_konsulter",
            templateName: "Konsulter",
            catalog: SEED_CATALOG,
          }),
          "startdatum",
          { usage: "case_start" },
        ),
        { metrics: { active: "anstallda_konsulter" } },
      ),
      SEED_CATALOG,
    );
    if (config.kind !== "cases") throw new Error("cases expected");
    const legacy = {
      ...config,
      cases: {
        ...config.cases,
        metrics: { active: "anstallda_konsulter", tenureMonths: "anstallningstid" },
      },
    };
    const state = fromTemplateConfig(legacy, SRC, {
      datasetKey: "ip_konsulter",
      templateName: "Konsulter",
      catalog: SEED_CATALOG,
    });
    expect(state.cases.metrics).toEqual({
      active: "anstallda_konsulter",
      tenureMonthsSum: "anstallningsmanader",
    });
    expect(hasBlockingProblems(validateMapping(state, SEED_CATALOG))).toBe(false);
  });

  it("builds the cases config from the usages", () => {
    const config = toTemplateConfig(cases(), SEED_CATALOG);
    expect(config).toMatchObject({
      kind: "cases",
      steps: [{ op: "drop", column: "namn" }],
      cases: {
        keyColumn: "gen-nummer",
        startColumn: "startdatum",
        endColumn: "slutdatum",
        resultColumn: "resultat",
        resultMap: { arbete: "Arbete", studier: "Studier" },
        groupBy: ["ort"],
        fromMonth: "2025-01",
        metrics: { active: "aktiva_deltagare", results: "resultat_deltagare" },
      },
      company: { kind: "per_upload" },
    });
  });

  it("requires a start column and a result column for the result measure", () => {
    const messages = (s: MappingState) => validateMapping(s, SEED_CATALOG).map((p) => p.message);
    expect(messages(setField(cases(), "startdatum", { usage: "ignore" }))).toContain(
      "Välj kolumnen med startdatum.",
    );
    expect(messages(setField(cases(), "resultat", { usage: "ignore" }))).toContain(
      "Välj kolumnen med resultat, eller ta bort måttet för arbete och studier.",
    );
    expect(messages(setCases(cases(), { metrics: {} }))).toContain(
      "Välj minst ett mått att räkna fram.",
    );
    expect(hasBlockingProblems(validateMapping(cases(), SEED_CATALOG))).toBe(false);
  });

  it("drops removed columns before anything is counted", () => {
    const table: WorkingTable = {
      columns: SRC.map((s) => s.name),
      rows: [
        {
          sourceRow: 2,
          values: {
            "gen-nummer": "1",
            namn: "A",
            ort: "Märsta",
            startdatum: "2026-01-10",
            slutdatum: null,
            resultat: null,
          },
        },
        {
          sourceRow: 3,
          values: {
            "gen-nummer": "2",
            namn: "B",
            ort: "Märsta",
            startdatum: "2026-02-01",
            slutdatum: "2026-02-20",
            resultat: "Arbete",
          },
        },
      ],
    };
    const config = toTemplateConfig(
      setCompanyChoice(cases(), { kind: "fixed", company: "MBAB" }),
      SEED_CATALOG,
    );
    if (config.kind !== "cases") throw new Error("cases expected");
    const out = applySteps(table, config.steps, { aliases: {} });
    expect(out.table.columns).not.toContain("namn");
  });
});

describe("simulateColumns", () => {
  it("follows the pipeline's column order", () => {
    const steps: Step[] = [
      { op: "merge", columns: ["b", "c"], separator: " ", into: "bc" },
      { op: "split", column: "a", mode: "year_month", into: ["år", "mån"] },
      { op: "constant", column: "k", value: "1" },
      { op: "unpivot", columns: ["d", "e"], nameColumn: "n", valueColumn: "v" },
      { op: "reorder", order: ["k"] },
    ];
    const flow = simulateColumns(["a", "b", "c", "d", "e"], steps);
    const table: WorkingTable = {
      columns: ["a", "b", "c", "d", "e"],
      rows: [{ sourceRow: 2, values: { a: "2026-09", b: "x", c: "y", d: 1, e: 2 } }],
    };
    expect(flow.columns).toEqual(applySteps(table, steps, { aliases: {} }).table.columns);
    expect(flow.consumedBy).toEqual({ b: 0, c: 0, a: 1, d: 3, e: 3 });
    expect(flow.createdBy).toEqual({ bc: 0, år: 1, mån: 1, k: 2, n: 3, v: 3 });
    expect(flow.broken).toEqual([]);
  });

  it("skips steps whose input is missing, like the pipeline", () => {
    const flow = simulateColumns(
      ["a"],
      [
        { op: "drop", column: "x" },
        { op: "rename", column: "a", to: "b" },
      ],
    );
    expect(flow.columns).toEqual(["b"]);
    expect(flow.broken.map((b) => [b.index, b.missing])).toEqual([[0, ["x"]]]);
  });
});
