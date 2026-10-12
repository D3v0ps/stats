import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { StepSchema, type Step } from "@/lib/contracts";
import type { CellValue, WorkingTable } from "../working";
import { applySteps, replaySteps } from "./index";
import type { StepContext } from "./types";

const ctx: StepContext = { aliases: { verksamhet: { krom: "KROM", rom2: "ROM2" } } };
const step = (s: unknown): Step => StepSchema.parse(s);

const base: WorkingTable = {
  columns: ["kund", "program", "timmar", "status"],
  headers: { kund: "Kund", program: "Program", timmar: "Timmar", status: "Status" },
  rows: [
    {
      sourceRow: 2,
      values: { kund: "Acme", program: "krom", timmar: "8,5", status: "Attesterad" },
    },
    { sourceRow: 3, values: { kund: null, program: "ROM2", timmar: "7", status: "Attesterad" } },
    { sourceRow: 4, values: { kund: "Beta", program: "Okänt", timmar: "abc", status: "Utkast" } },
    { sourceRow: 5, values: { kund: null, program: "Annat", timmar: "1", status: "Utkast" } },
  ],
};

describe("applySteps", () => {
  const steps = [
    step({ op: "fill_down", column: "kund" }),
    step({ op: "lookup", column: "program", dimension: "verksamhet" }),
    step({ op: "clean", column: "timmar", as: "hours" }),
    step({ op: "drop", column: "missing" }),
    step({ op: "rename", column: "program", to: "verksamhet" }),
  ];

  it("applies steps in order and collects issues", () => {
    const r = applySteps(base, steps, ctx);
    expect(r.table.columns).toEqual(["kund", "verksamhet", "timmar", "status"]);
    expect(r.table.rows.map((x) => x.values)).toEqual([
      { kund: "Acme", verksamhet: "KROM", timmar: 8.5, status: "Attesterad" },
      { kund: "Acme", verksamhet: "ROM2", timmar: 7, status: "Attesterad" },
      { kund: "Beta", verksamhet: "Okänt", timmar: "abc", status: "Utkast" },
      { kund: "Beta", verksamhet: "Annat", timmar: 1, status: "Utkast" },
    ]);
    expect(r.issues.map((i) => [i.sourceRow, i.column, i.severity])).toEqual([
      [4, "timmar", "error"],
      [0, "missing", "error"],
    ]);
    expect(r.issues[1]!.message).toMatch(/^Steg 4 \(Ta bort kolumn\)/);
    expect(r.unknownLookups).toEqual({ verksamhet: ["Okänt", "Annat"] });
  });

  it("reports only unknown values still present after later filters", () => {
    const r = applySteps(
      base,
      [
        step({ op: "lookup", column: "program", dimension: "verksamhet" }),
        step({ op: "filter", column: "status", operator: "equals", value: "utkast" }),
      ],
      ctx,
    );
    expect(r.unknownLookups).toEqual({});
    expect(r.skipped.map((s) => s.sourceRow)).toEqual([4, 5]);
  });

  it("never mutates its input", () => {
    const snapshot = structuredClone(base);
    applySteps(base, steps, ctx);
    expect(base).toEqual(snapshot);
  });

  it("returns the same table for no steps", () => {
    expect(applySteps(base, [], ctx).table).toBe(base);
  });
});

describe("replaySteps (undo)", () => {
  const steps = [
    step({ op: "fill_down", column: "kund" }),
    step({ op: "filter", column: "status", operator: "equals", value: "utkast" }),
    step({ op: "constant", column: "bolag", value: "MBAB" }),
  ];

  it("replaying k steps equals applying the prefix", () => {
    for (let k = 0; k <= steps.length; k++) {
      expect(replaySteps(base, steps, k, ctx)).toEqual(applySteps(base, steps.slice(0, k), ctx));
    }
  });

  it("undoing the last step restores the previous state", () => {
    const after2 = applySteps(base, steps.slice(0, 2), ctx).table;
    expect(replaySteps(base, steps, 2, ctx).table).toEqual(after2);
    expect(replaySteps(base, steps, 2, ctx).table.columns).not.toContain("bolag");
  });

  it("clamps negative counts", () => {
    expect(replaySteps(base, steps, -1, ctx).table).toBe(base);
  });
});

// ---- Property tests --------------------------------------------------------

const COLUMNS = ["a", "b", "c"];
const NAMES = ["a", "b", "c", "d", "x y", "n1"];

const cellArb: fc.Arbitrary<CellValue> = fc.oneof(
  fc.constantFrom<CellValue>(
    null,
    "",
    " ",
    "x",
    "X",
    "1 200",
    "8,5",
    "1.234",
    "Svensson, Anna",
    "2026-09",
    "krom",
    "-",
  ),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
);

const tableArb: fc.Arbitrary<WorkingTable> = fc
  .array(fc.tuple(cellArb, cellArb, cellArb), { maxLength: 12 })
  .map((rows) => ({
    columns: [...COLUMNS],
    headers: { a: "A", b: "B", c: "C" },
    rows: rows.map((r, i) => ({ sourceRow: i + 2, values: { a: r[0], b: r[1], c: r[2] } })),
  }));

const name = fc.constantFrom(...NAMES);
const stepArb: fc.Arbitrary<Step> = fc
  .oneof(
    fc.record({ op: fc.constant("rename"), column: name, to: name }),
    fc.record({ op: fc.constant("drop"), column: name }),
    fc.record({
      op: fc.constant("merge"),
      columns: fc.uniqueArray(name, { minLength: 2, maxLength: 3 }),
      separator: fc.constantFrom(" ", "-", ""),
      into: name,
    }),
    fc.record({
      op: fc.constant("split"),
      column: name,
      mode: fc.constantFrom("delimiter", "year_month", "last_first"),
      delimiter: fc.constantFrom(",", " ", "-"),
      into: fc.uniqueArray(name, { minLength: 2, maxLength: 3 }),
    }),
    fc.record({
      op: fc.constant("replace"),
      column: name,
      find: fc.constantFrom("x", "1", "", "anna"),
      replace: fc.constantFrom("y", "", "Z"),
      match: fc.constantFrom("contains", "whole_cell"),
      caseSensitive: fc.boolean(),
    }),
    fc.record({
      op: fc.constant("clean"),
      column: name,
      as: fc.constantFrom("number", "amount", "hours", "percent", "trim"),
    }),
    fc.record({
      op: fc.constant("lookup"),
      column: name,
      dimension: fc.constantFrom("verksamhet", "ort"),
    }),
    fc.record({
      op: fc.constant("filter"),
      column: name,
      operator: fc.constantFrom("equals", "not_equals", "contains", "empty", "not_empty"),
      value: fc.constantFrom("x", "8,5", "1"),
      caseSensitive: fc.boolean(),
    }),
    fc.record({ op: fc.constant("reorder"), order: fc.uniqueArray(name, { maxLength: 3 }) }),
    fc.record({
      op: fc.constant("unpivot"),
      columns: fc.uniqueArray(name, { minLength: 1, maxLength: 2 }),
      nameColumn: name,
      valueColumn: name,
    }),
    fc.record({ op: fc.constant("fill_down"), column: name }),
    fc.record({ op: fc.constant("negate"), column: name }),
    fc.record({ op: fc.constant("constant"), column: name, value: fc.constantFrom("MBAB", "") }),
  )
  .map((s) => StepSchema.parse(s));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe("pipeline properties", () => {
  it("applying steps[0..k] twice is deterministic and never mutates the input", () => {
    fc.assert(
      fc.property(tableArb, fc.array(stepArb, { maxLength: 8 }), fc.nat(), (table, steps, kRaw) => {
        const k = kRaw % (steps.length + 1);
        const frozen = deepFreeze(structuredClone(table));
        const first = replaySteps(frozen, steps, k, ctx);
        const second = replaySteps(frozen, steps, k, ctx);
        expect(second).toEqual(first);
        expect(frozen).toEqual(table);
      }),
      { numRuns: 300 },
    );
  });

  it("steps compose: prefix then suffix gives the same table as all at once", () => {
    fc.assert(
      fc.property(tableArb, fc.array(stepArb, { maxLength: 8 }), fc.nat(), (table, steps, kRaw) => {
        const k = kRaw % (steps.length + 1);
        const whole = applySteps(table, steps, ctx).table;
        const prefix = applySteps(table, steps.slice(0, k), ctx).table;
        const composed = applySteps(prefix, steps.slice(k), ctx).table;
        expect(composed).toEqual(whole);
      }),
      { numRuns: 300 },
    );
  });

  it("every row keeps exactly the table's columns and a positive source row", () => {
    fc.assert(
      fc.property(tableArb, fc.array(stepArb, { maxLength: 8 }), (table, steps) => {
        const { table: out } = applySteps(table, steps, ctx);
        expect(new Set(out.columns).size).toBe(out.columns.length);
        for (const row of out.rows) {
          expect(Object.keys(row.values).sort()).toEqual([...out.columns].sort());
          expect(row.sourceRow).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });
});
