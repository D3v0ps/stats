import { describe, expect, it } from "vitest";
import type { Step } from "@/lib/contracts";
import { applySteps } from "@/lib/ingest/pipeline";
import type { WorkingTable } from "@/lib/ingest/working";
import {
  describeStep,
  renameInSteps,
  stepInputs,
  stepOutputs,
  stepRemoves,
  stepsReference,
} from "./steps";
import { TOOLS, buildTool, defaultSplitNames, guessMonthColumns } from "./tools";

const columns = ["kund", "datum", "timmar", "status", "förnamn", "efternamn"];

describe("buildTool", () => {
  it("offers the eleven tools", () => {
    expect(TOOLS.map((t) => t.kind)).toEqual([
      "merge",
      "split",
      "lookup",
      "replace",
      "clean",
      "filter",
      "fill_down",
      "negate",
      "constant",
      "unpivot",
      "counter",
    ]);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(10);
  });

  it("builds a merge and validates its inputs", () => {
    expect(
      buildTool("merge", { columns: ["förnamn", "efternamn"], into: "namn" }, columns),
    ).toEqual({
      ok: true,
      step: { op: "merge", columns: ["förnamn", "efternamn"], separator: " ", into: "namn" },
    });
    expect(buildTool("merge", { columns: ["förnamn"], into: "namn" }, columns)).toMatchObject({
      ok: false,
    });
    expect(
      buildTool("merge", { columns: ["förnamn", "efternamn"], into: "kund" }, columns),
    ).toEqual({
      ok: false,
      problem: "Det finns redan en kolumn som heter ”kund”.",
    });
    // The merged-away columns' names are free again.
    expect(
      buildTool("merge", { columns: ["förnamn", "efternamn"], into: "förnamn" }, columns),
    ).toMatchObject({ ok: true });
  });

  it("builds splits for every mode", () => {
    expect(
      buildTool(
        "split",
        { column: "datum", mode: "year_month", intoList: defaultSplitNames("datum", "year_month") },
        columns,
      ),
    ).toEqual({
      ok: true,
      step: { op: "split", column: "datum", mode: "year_month", into: ["år", "månad"] },
    });
    expect(
      buildTool("split", { column: "kund", mode: "delimiter", intoList: ["a", "b"] }, columns),
    ).toEqual({ ok: false, problem: "Ange vilket tecken som delar upp texten." });
    expect(
      buildTool(
        "split",
        { column: "kund", mode: "delimiter", delimiter: "/", intoList: ["a", "a"] },
        columns,
      ),
    ).toEqual({ ok: false, problem: "Namnet ”a” anges två gånger." });
  });

  it("builds filter, replace, clean, lookup, fill down, negate and constant", () => {
    expect(
      buildTool("filter", { column: "status", operator: "equals", value: " Makulerad " }, columns),
    ).toEqual({
      ok: true,
      step: {
        op: "filter",
        column: "status",
        operator: "equals",
        value: "Makulerad",
        caseSensitive: false,
      },
    });
    expect(buildTool("filter", { column: "status", operator: "empty" }, columns)).toEqual({
      ok: true,
      step: { op: "filter", column: "status", operator: "empty", caseSensitive: false },
    });
    expect(
      buildTool("filter", { column: "status", operator: "contains", value: "" }, columns),
    ).toMatchObject({
      ok: false,
    });
    expect(
      buildTool(
        "replace",
        { column: "kund", find: "Postnord", replace: "PostNord AB", match: "whole_cell" },
        columns,
      ),
    ).toEqual({
      ok: true,
      step: {
        op: "replace",
        column: "kund",
        find: "Postnord",
        replace: "PostNord AB",
        match: "whole_cell",
        caseSensitive: false,
      },
    });
    expect(buildTool("clean", { column: "timmar", as: "hours" }, columns)).toEqual({
      ok: true,
      step: { op: "clean", column: "timmar", as: "hours" },
    });
    expect(buildTool("lookup", { column: "kund" }, columns)).toMatchObject({ ok: false });
    expect(buildTool("lookup", { column: "kund", dimension: "kund" }, columns)).toMatchObject({
      ok: true,
    });
    expect(buildTool("fill_down", { column: "kund" }, columns)).toEqual({
      ok: true,
      step: { op: "fill_down", column: "kund" },
    });
    expect(buildTool("negate", { column: "nope" }, columns)).toEqual({
      ok: false,
      problem: "Kolumnen ”nope” finns inte längre.",
    });
    expect(buildTool("constant", { column: "verksamhet", value: "Bemanning" }, columns)).toEqual({
      ok: true,
      step: { op: "constant", column: "verksamhet", value: "Bemanning" },
    });
    expect(buildTool("constant", { column: "__proto__", value: "x" }, columns)).toMatchObject({
      ok: false,
    });
  });

  it("builds unpivot and counters", () => {
    expect(
      buildTool(
        "unpivot",
        { columns: ["jan", "feb"], nameColumn: "månad", valueColumn: "belopp" },
        ["post", "jan", "feb"],
      ),
    ).toEqual({
      ok: true,
      step: { op: "unpivot", columns: ["jan", "feb"], nameColumn: "månad", valueColumn: "belopp" },
    });
    expect(
      buildTool("unpivot", { columns: ["jan"], nameColumn: "x", valueColumn: "x" }, ["jan"]),
    ).toEqual({ ok: false, problem: "De två nya kolumnerna måste ha olika namn." });
    expect(buildTool("counter", { metricKey: "pass" }, columns)).toEqual({
      ok: true,
      counter: { metricKey: "pass", kind: "count_rows" },
    });
    expect(buildTool("counter", {}, columns)).toMatchObject({ ok: false });
  });
});

describe("guessMonthColumns", () => {
  it("finds month headers in several spellings", () => {
    expect(
      guessMonthColumns([
        "post",
        "jan",
        "februari",
        "mars",
        "2026-04",
        "apr 2026",
        "helår",
        "sept.",
      ]),
    ).toEqual(["jan", "februari", "mars", "2026-04", "apr 2026", "sept."]);
  });

  it("uses display headers when given", () => {
    expect(guessMonthColumns(["kolumn b"], { "kolumn b": "Jan" })).toEqual(["kolumn b"]);
  });
});

describe("step bookkeeping", () => {
  it("knows inputs, outputs and removed columns", () => {
    const merge: Step = { op: "merge", columns: ["a", "b"], separator: " ", into: "c" };
    expect(stepInputs(merge)).toEqual(["a", "b"]);
    expect(stepOutputs(merge)).toEqual(["c"]);
    expect(stepRemoves(merge)).toEqual(["a", "b"]);
    const unpivot: Step = {
      op: "unpivot",
      columns: ["jan", "feb"],
      nameColumn: "m",
      valueColumn: "v",
    };
    expect(stepRemoves(unpivot)).toEqual(["jan", "feb"]);
    expect(stepInputs({ op: "constant", column: "x", value: "1" })).toEqual([]);
    expect(stepOutputs({ op: "constant", column: "x", value: "1" })).toEqual(["x"]);
    expect(stepRemoves({ op: "rename", column: "a", to: "b" })).toEqual(["a"]);
  });

  it("renames references but not created names", () => {
    const steps = renameInSteps(
      [
        { op: "filter", column: "a", operator: "empty", caseSensitive: false },
        { op: "merge", columns: ["a", "b"], separator: "-", into: "a2" },
        { op: "constant", column: "a", value: "x" },
        { op: "reorder", order: ["b", "a"] },
      ],
      "a",
      "z",
    );
    expect(steps).toEqual([
      { op: "filter", column: "z", operator: "empty", caseSensitive: false },
      { op: "merge", columns: ["z", "b"], separator: "-", into: "a2" },
      { op: "constant", column: "a", value: "x" },
      { op: "reorder", order: ["b", "z"] },
    ]);
    expect(stepsReference(steps, "z")).toBe(true);
    expect(stepsReference(steps, "a")).toBe(false);
  });

  it("describes every step in plain Swedish", () => {
    expect(
      describeStep({
        op: "filter",
        column: "status",
        operator: "equals",
        value: "Makulerad",
        caseSensitive: false,
      }),
    ).toBe("Ta bort rader där ”status” är ”Makulerad”");
    expect(describeStep({ op: "lookup", column: "kund", dimension: "kund" })).toBe(
      "Översätt ”kund” med uppslagstabellen för Kund",
    );
    expect(
      describeStep({
        op: "unpivot",
        columns: ["jan", "feb"],
        nameColumn: "månad",
        valueColumn: "belopp",
      }),
    ).toBe("Vrid 2 kolumner till rader: rubriken i ”månad”, värdet i ”belopp”");
    expect(describeStep({ op: "merge", columns: ["a", "b", "c"], separator: " ", into: "d" })).toBe(
      "Slå ihop ”a”, ”b” och ”c” till ”d”",
    );
    expect(describeStep({ op: "constant", column: "verksamhet", value: "Bemanning" })).toBe(
      "Lägg till ”verksamhet” med värdet ”Bemanning”",
    );
    expect(
      describeStep(
        { op: "clean", column: "timmar", as: "hours" },
        { columnLabel: (c) => c.toUpperCase() },
      ),
    ).toBe("Rensa formatet i ”TIMMAR” (timmar)");
  });

  it("produces steps the pipeline accepts", () => {
    const table: WorkingTable = {
      columns: ["förnamn", "efternamn", "timmar"],
      rows: [{ sourceRow: 2, values: { förnamn: "Anna", efternamn: "Berg", timmar: "8,5 h" } }],
    };
    const merge = buildTool(
      "merge",
      { columns: ["förnamn", "efternamn"], into: "namn" },
      table.columns,
    );
    const clean = buildTool("clean", { column: "timmar", as: "hours" }, table.columns);
    if (!merge.ok || !("step" in merge) || !clean.ok || !("step" in clean))
      throw new Error("bad tool");
    const out = applySteps(table, [merge.step, clean.step], { aliases: {} });
    expect(out.issues).toEqual([]);
    expect(out.table.rows[0]?.values).toEqual({ namn: "Anna Berg", timmar: 8.5 });
  });
});
