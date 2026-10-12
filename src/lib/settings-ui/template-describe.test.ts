import { describe, expect, it } from "vitest";
import { TemplateConfigSchema, type Step } from "@/lib/contracts/pipeline";
import {
  describeStep,
  describeTemplate,
  signatureSummary,
  type DescribeContext,
} from "./template-describe";

const ctx: DescribeContext = {
  metricNames: {
    timmar: "Fakturerade timmar",
    sjukpass: "Sjukpass",
    aktiva_deltagare: "Aktiva deltagare",
  },
  dimensionLabels: { kund: "Kund", verksamhet: "Verksamhet" },
};

describe("describeStep", () => {
  const cases: [Step, string, string][] = [
    [{ op: "rename", column: "kundnamn", to: "kund" }, "Byt namn", "”kundnamn” heter nu ”kund”"],
    [{ op: "drop", column: "e-post" }, "Ta bort kolumn", "Kolumnen ”e-post” tas bort"],
    [
      { op: "merge", columns: ["för", "efter"], separator: " ", into: "namn" },
      "Slå ihop",
      "”för”, ”efter” slås ihop med mellanslag till ”namn”",
    ],
    [
      { op: "split", column: "period", mode: "year_month", into: ["år", "månad"] },
      "Dela upp",
      "”period” delas i år och månad till ”år”, ”månad”",
    ],
    [
      { op: "split", column: "x", mode: "delimiter", delimiter: ";", into: ["a", "b"] },
      "Dela upp",
      "”x” delas vid ”;” till ”a”, ”b”",
    ],
    [
      {
        op: "replace",
        column: "kund",
        find: "AB",
        replace: "",
        match: "contains",
        caseSensitive: true,
      },
      "Ersätt",
      "”AB” blir (tomt) i ”kund” (delar av cellen, skiftlägeskänsligt)",
    ],
    [{ op: "clean", column: "belopp", as: "amount" }, "Rensa", "”belopp” läses som belopp"],
    [
      { op: "lookup", column: "kundkod", dimension: "kund" },
      "Översätt",
      "”kundkod” översätts med uppslagen för ”Kund”",
    ],
    [
      {
        op: "filter",
        column: "status",
        operator: "equals",
        value: "Makulerad",
        caseSensitive: false,
      },
      "Filtrera bort rader",
      "Rader där ”status” är ”Makulerad” tas bort",
    ],
    [
      { op: "filter", column: "kund", operator: "empty", caseSensitive: false },
      "Filtrera bort rader",
      "Rader där ”kund” är tom tas bort",
    ],
    [{ op: "reorder", order: ["a", "b"] }, "Ändra ordning", "Ordning: ”a”, ”b”"],
    [
      { op: "unpivot", columns: ["jan", "feb"], nameColumn: "månad", valueColumn: "belopp" },
      "Vrid kolumner till rader",
      "”jan”, ”feb” blir rader med rubriken i ”månad” och värdet i ”belopp”",
    ],
    [{ op: "fill_down", column: "kund" }, "Fyll nedåt", "Tomma celler i ”kund” får värdet ovanför"],
    [{ op: "negate", column: "belopp" }, "Byt tecken", "Talen i ”belopp” byter tecken"],
    [
      { op: "constant", column: "verksamhet", value: "Bemanning" },
      "Fast värde",
      "Ny kolumn ”verksamhet” med värdet ”Bemanning”",
    ],
  ];

  it.each(cases)("describes %o", (step, label, detail) => {
    expect(describeStep(step, ctx)).toEqual({ label, detail });
  });
});

describe("describeTemplate", () => {
  it("describes a table template", () => {
    const config = TemplateConfigSchema.parse({
      kind: "table",
      steps: [{ op: "rename", column: "kundnamn", to: "kund" }],
      columns: [
        { column: "timmar", type: "hours", usage: "measure", metricKey: "timmar" },
        { column: "kund", type: "text", usage: "dimension", dimensionKey: "kund" },
        { column: "namn", type: "text", usage: "ignore", personal: true, keep: false },
      ],
      counters: [{ metricKey: "sjukpass", kind: "count_rows" }],
      period: { kind: "per_upload" },
      company: { kind: "column", column: "bolag", mapping: { "mb ab": "MBAB" } },
    });
    const d = describeTemplate(config, ctx);
    expect(d.kindLabel).toBe("Tabell (en rad per post)");
    expect(d.steps).toEqual([{ label: "Byt namn", detail: "”kundnamn” heter nu ”kund”" }]);
    expect(d.columns).toEqual([
      {
        column: "timmar",
        usage: "Siffra att räkna på",
        type: "Timmar",
        target: "Fakturerade timmar",
        removed: false,
        personal: false,
      },
      {
        column: "kund",
        usage: "Gruppera på",
        type: "Text",
        target: "Kund",
        removed: false,
        personal: false,
      },
      {
        column: "namn",
        usage: "Ta inte med",
        type: "Text",
        target: null,
        removed: true,
        personal: true,
      },
    ]);
    expect(d.settings).toEqual([
      { label: "Period", value: "Väljs vid uppladdning (hela filen är en månad)" },
      { label: "Bolag", value: "Kolumnen ”bolag” (”mb ab” = MB AB)" },
      { label: "Scenario", value: "Utfall" },
      { label: "Räknar rader", value: "Sjukpass" },
    ]);
  });

  it("describes a cases template", () => {
    const config = TemplateConfigSchema.parse({
      kind: "cases",
      columns: [],
      cases: {
        startColumn: "start",
        endColumn: "slut",
        keyColumn: "gen",
        resultColumn: "resultat",
        resultMap: { arbete: "Arbete" },
        groupBy: ["verksamhet"],
        metrics: { active: "aktiva_deltagare" },
        fromMonth: "2025-03",
      },
      company: { kind: "fixed", company: "MBR" },
    });
    const d = describeTemplate(config, ctx);
    expect(d.kindLabel).toBe("Ärenden (start- och slutdatum)");
    expect(d.settings).toEqual([
      { label: "Bolag", value: "MB Restart" },
      { label: "Startdatum", value: "”start”" },
      { label: "Slutdatum", value: "”slut”" },
      { label: "Id (räknas, sparas inte)", value: "”gen”" },
      { label: "Resultat", value: "”resultat”" },
      { label: "Resultatvärden", value: "”arbete” = Arbete" },
      { label: "Grupperas på", value: "”verksamhet”" },
      { label: "Mått", value: "Aktiva vid månadens slut → Aktiva deltagare" },
      { label: "Första månad", value: "mars 2025" },
    ]);
  });

  it("describes the budget sign and a hand-picked header row", () => {
    const config = TemplateConfigSchema.parse({
      kind: "table",
      columns: [{ column: "belopp", type: "amount", usage: "measure", metricKey: "budget_belopp" }],
      period: { kind: "per_upload" },
      company: { kind: "fixed", company: "MBAB" },
      scenario: "budget",
      budgetSign: "result",
      headerRow: 3,
    });
    expect(describeTemplate(config, ctx).settings.slice(2)).toEqual([
      { label: "Scenario", value: "Budget" },
      { label: "Belopp i filen", value: "Intäkter plus, kostnader minus" },
      { label: "Rubrikrad", value: "Rad 4 (vald för hand)" },
    ]);
    // A budget template without the field stores the amounts as they are.
    const {
      budgetSign: _sign,
      headerRow: _row,
      ...plain
    } = config as typeof config & {
      kind: "table";
    };
    expect([_sign, _row]).toEqual(["result", 3]);
    expect(describeTemplate(plain, ctx).settings.at(-1)).toEqual({
      label: "Belopp i filen",
      value: "Som i bokföringen (intäkter minus, kostnader plus)",
    });
  });

  it("describes a SIE template", () => {
    const d = describeTemplate({ kind: "sie", objectDims: [1, 6] }, ctx);
    expect(d.steps).toEqual([]);
    expect(d.settings[1]).toEqual({
      label: "Objekt som sparas",
      value: "Dimension 1 (kostnadsställe), 6 (projekt)",
    });
  });
});

describe("signatureSummary", () => {
  it("shortens long header lists", () => {
    expect(signatureSummary([])).toBe("–");
    expect(signatureSummary(["a", "b"])).toBe("a, b");
    expect(signatureSummary(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d + 2 till");
  });
});
