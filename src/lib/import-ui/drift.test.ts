import { describe, expect, it } from "vitest";
import type { CasesTemplateConfig, SignatureDiff, TableTemplateConfig } from "@/lib/contracts";
import { fillNewColumns, migrateConfig, proposeRenames } from "./drift";
import { initialMapping } from "./mapping";
import { driftChanges } from "./recognition";
import { SEED_CATALOG } from "./test-fixtures";

const diff = (d: Partial<SignatureDiff>): SignatureDiff => ({
  added: [],
  removed: [],
  renamed: [],
  reordered: false,
  compatible: false,
  ...d,
});

describe("proposeRenames", () => {
  it("keeps the diff's renames and adds word-containment pairs", () => {
    expect(
      proposeRenames(
        diff({
          added: ["antal timmar", "avdelning"],
          removed: ["timmar"],
          renamed: [{ from: "kundnamn", to: "kund namn", similarity: 0.9 }],
        }),
      ),
    ).toEqual([
      { from: "kundnamn", to: "kund namn", certain: true },
      { from: "timmar", to: "antal timmar", certain: false },
    ]);
  });

  it("does not guess when several columns could match", () => {
    expect(
      proposeRenames(diff({ added: ["timmar ord", "timmar ob"], removed: ["timmar"] })),
    ).toEqual([]);
    expect(proposeRenames(diff({ added: ["antal timmar"], removed: ["timmar", "antal"] }))).toEqual(
      [],
    );
  });
});

describe("migrateConfig", () => {
  const table: TableTemplateConfig = {
    kind: "table",
    steps: [
      {
        op: "filter",
        column: "status",
        operator: "equals",
        value: "Makulerad",
        caseSensitive: false,
      },
      { op: "clean", column: "timmar", as: "hours" },
      { op: "fill_down", column: "avdelning" },
    ],
    columns: [
      {
        column: "kund",
        type: "text",
        usage: "dimension",
        dimensionKey: "kund",
        personal: false,
        keep: true,
      },
      {
        column: "timmar",
        type: "hours",
        usage: "measure",
        metricKey: "timmar",
        personal: false,
        keep: true,
      },
      { column: "avdelning", type: "text", usage: "ignore", personal: false, keep: true },
      { column: "namn", type: "text", usage: "ignore", personal: true, keep: false },
      { column: "datum", type: "date", usage: "period", personal: false, keep: true },
    ],
    counters: [],
    period: { kind: "column", column: "datum" },
    company: { kind: "fixed", company: "MBAB" },
    scenario: "utfall",
  };

  it("renames back, drops what needs missing columns and reports it", () => {
    const m = migrateConfig(
      table,
      diff({ added: ["antal timmar"], removed: ["timmar", "avdelning", "datum"] }),
      ["kund", "status", "antal timmar", "namn"],
    );
    expect(m.renames).toEqual([{ from: "antal timmar", to: "timmar" }]);
    expect(m.missingColumns).toEqual(["avdelning", "datum"]);
    expect(m.removedSteps).toEqual([{ op: "fill_down", column: "avdelning" }]);
    expect(m.config.steps).toEqual([
      { op: "rename", column: "antal timmar", to: "timmar" },
      table.steps[0],
      table.steps[1],
    ]);
    expect(m.config.columns.map((c) => c.column)).toEqual(["kund", "timmar", "namn"]);
    expect(m.config.period).toEqual({ kind: "per_upload" });
    expect(m.config.company).toEqual({ kind: "fixed", company: "MBAB" });
  });

  it("clears case fields whose columns are gone", () => {
    const cases: CasesTemplateConfig = {
      kind: "cases",
      steps: [],
      columns: [
        { column: "start", type: "date", usage: "case_start", personal: false, keep: true },
        { column: "resultat", type: "text", usage: "case_result", personal: false, keep: true },
        {
          column: "ort",
          type: "text",
          usage: "dimension",
          dimensionKey: "ort",
          personal: false,
          keep: true,
        },
      ],
      company: { kind: "column", column: "bolag", mapping: {} },
      cases: {
        startColumn: "start",
        resultColumn: "resultat",
        resultMap: {},
        groupBy: ["ort"],
        metrics: { active: "aktiva_deltagare" },
      },
    };
    const m = migrateConfig(cases, diff({ removed: ["resultat", "ort", "bolag"] }), ["start"]);
    expect(m.config.cases).toEqual({
      startColumn: "start",
      resultMap: {},
      groupBy: [],
      metrics: { active: "aktiva_deltagare" },
    });
    expect(m.config.company).toEqual({ kind: "per_upload" });
  });
});

describe("fillNewColumns", () => {
  it("maps new columns from suggestions and removes new personal columns", () => {
    const base = initialMapping(
      [
        {
          name: "kund",
          header: "Kund",
          samples: [],
          inferredType: "text",
          personal: false,
          locked: false,
        },
        {
          name: "e-post",
          header: "E-post",
          samples: [],
          inferredType: "text",
          personal: true,
          locked: false,
        },
        {
          name: "ort",
          header: "Ort",
          samples: [],
          inferredType: "text",
          personal: false,
          locked: false,
        },
      ],
      [],
      { datasetKey: "ip_timmar", templateName: "x", catalog: SEED_CATALOG },
    );
    const kept = {
      ...base,
      sources: base.sources.map((s) => ({ ...s, keep: true })),
      fields: { kund: base.fields.kund! },
    };
    const next = fillNewColumns(
      kept,
      [
        { column: "e-post", type: "text", usage: "ignore", personal: true, keep: false },
        { column: "ort", type: "text", usage: "dimension", personal: false, keep: true },
      ],
      ["e-post", "ort"],
    );
    expect(next.sources.find((s) => s.name === "e-post")).toMatchObject({
      keep: false,
      personal: true,
    });
    expect(next.fields.ort).toEqual({ type: "text", usage: "dimension" });
    expect(next.sources.find((s) => s.name === "kund")?.keep).toBe(true);
  });
});

describe("driftChanges", () => {
  it("lists new, missing and renamed columns in plain words", () => {
    expect(
      driftChanges(
        diff({
          added: ["avdelning"],
          removed: ["status"],
          renamed: [{ from: "tid", to: "timmar", similarity: 0.7 }],
        }),
      ),
    ).toEqual([
      { kind: "added", label: "Ny kolumn", column: "avdelning" },
      { kind: "removed", label: "Saknad kolumn", column: "status" },
      { kind: "renamed", label: "Omdöpt kolumn", from: "tid", to: "timmar" },
    ]);
  });
});
