import { describe, expect, it } from "vitest";
import { StepSchema, type Step } from "@/lib/contracts";
import type { CellValue, WorkingTable } from "../working";
import { applyStep } from "./index";
import type { StepContext } from "./types";

const step = (s: unknown): Step => StepSchema.parse(s);
const ctx: StepContext = {
  aliases: {
    verksamhet: {
      krom: "KROM",
      "rusta och matcha 2": "ROM2",
      rom2: "ROM2",
      "stöd & matchning": "Stöd och matchning",
    },
  },
};

function table(
  columns: string[],
  rows: CellValue[][],
  headers?: Record<string, string>,
): WorkingTable {
  const t: WorkingTable = {
    columns,
    rows: rows.map((r, i) => ({
      sourceRow: i + 2,
      values: Object.fromEntries(columns.map((c, j) => [c, r[j] ?? null])),
    })),
  };
  if (headers) t.headers = headers;
  return t;
}

const col = (t: WorkingTable, c: string) => t.rows.map((r) => r.values[c]);
const run = (t: WorkingTable, s: unknown) => applyStep(t, step(s), ctx, 0);

describe("missing columns", () => {
  it.each([
    { op: "rename", column: "x", to: "y" },
    { op: "drop", column: "x" },
    { op: "merge", columns: ["a", "x"], separator: " ", into: "m" },
    { op: "split", column: "x", mode: "delimiter", delimiter: "-", into: ["p", "q"] },
    { op: "replace", column: "x", find: "a", replace: "b", match: "contains" },
    { op: "clean", column: "x", as: "number" },
    { op: "lookup", column: "x", dimension: "verksamhet" },
    { op: "filter", column: "x", operator: "empty" },
    { op: "reorder", order: ["x", "a"] },
    { op: "unpivot", columns: ["x"], nameColumn: "n", valueColumn: "v" },
    { op: "fill_down", column: "x" },
    { op: "negate", column: "x" },
  ])("$op on a missing column is an error and the step is skipped", (s) => {
    const t = table(["a", "b"], [["1", "2"]]);
    const r = run(t, s);
    expect(r.table).toBe(t);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ sourceRow: 0, column: "x", severity: "error" });
    expect(r.issues[0]!.message).toMatch(/^Steg 1 \(.+\): kolumnen "x" finns inte\.$/);
  });
});

describe("rename", () => {
  it("renames a column and its values, keeping order and headers", () => {
    const t = table(["a", "b"], [["1", "2"]], { a: "A", b: "B" });
    const r = run(t, { op: "rename", column: "a", to: "Kund" });
    expect(r.table.columns).toEqual(["Kund", "b"]);
    expect(r.table.rows[0]!.values).toEqual({ Kund: "1", b: "2" });
    expect(r.table.headers).toEqual({ b: "B", Kund: "Kund" });
    expect(r.issues).toEqual([]);
  });

  it("refuses to overwrite an existing column", () => {
    const t = table(["a", "b"], [["1", "2"]]);
    const r = run(t, { op: "rename", column: "a", to: "b" });
    expect(r.table).toBe(t);
    expect(r.issues[0]!.message).toMatch(/finns redan/);
  });

  it("refuses unsafe names", () => {
    const r = run(table(["a"], [["1"]]), { op: "rename", column: "a", to: "__proto__" });
    expect(r.issues[0]!.message).toMatch(/ogiltigt kolumnnamn/);
  });

  it("is a no-op when renaming to itself", () => {
    const t = table(["a"], [["1"]]);
    expect(run(t, { op: "rename", column: "a", to: "a" }).table).toBe(t);
  });
});

describe("drop", () => {
  it("removes the column and its values", () => {
    const r = run(table(["a", "b"], [["1", "2"]]), { op: "drop", column: "a" });
    expect(r.table.columns).toEqual(["b"]);
    expect(r.table.rows[0]!.values).toEqual({ b: "2" });
  });
});

describe("merge", () => {
  it("joins non-empty values with the separator at the first source position", () => {
    const t = table(
      ["nr", "x", "namn"],
      [
        ["1001", "a", "Lager"],
        ["1002", "b", null],
        [null, "c", ""],
      ],
    );
    const r = run(t, { op: "merge", columns: ["nr", "namn"], separator: " – ", into: "uppdrag" });
    expect(r.table.columns).toEqual(["uppdrag", "x"]);
    expect(col(r.table, "uppdrag")).toEqual(["1001 – Lager", "1002", null]);
  });

  it("may reuse a source column name as target", () => {
    const r = run(table(["a", "b"], [["x", "y"]]), {
      op: "merge",
      columns: ["a", "b"],
      separator: "",
      into: "a",
    });
    expect(r.table.columns).toEqual(["a"]);
    expect(col(r.table, "a")).toEqual(["xy"]);
  });

  it("refuses a target that collides with another column", () => {
    const r = run(table(["a", "b", "c"], [["x", "y", "z"]]), {
      op: "merge",
      columns: ["a", "b"],
      separator: " ",
      into: "c",
    });
    expect(r.issues[0]!.message).toMatch(/finns redan/);
  });
});

describe("split", () => {
  it("splits on a delimiter, keeping the rest in the last column", () => {
    const t = table(
      ["u", "z"],
      [
        ["1001 - Lager - Malmö", 1],
        ["1002", 2],
        [null, 3],
      ],
    );
    const r = run(t, {
      op: "split",
      column: "u",
      mode: "delimiter",
      delimiter: " - ",
      into: ["nr", "namn"],
    });
    expect(r.table.columns).toEqual(["nr", "namn", "z"]);
    expect(col(r.table, "nr")).toEqual(["1001", "1002", null]);
    expect(col(r.table, "namn")).toEqual(["Lager - Malmö", null, null]);
  });

  it("requires a delimiter in delimiter mode", () => {
    const r = run(table(["u"], [["a"]]), {
      op: "split",
      column: "u",
      mode: "delimiter",
      into: ["p", "q"],
    });
    expect(r.issues[0]!.message).toMatch(/avgränsare saknas/);
  });

  it("splits year_month values, including dates and YYYYMM numbers", () => {
    const t = table(["p"], [["2026-09"], ["2026-09-30"], [202610], ["sep 2026"], ["nonsens"]]);
    const r = run(t, { op: "split", column: "p", mode: "year_month", into: ["år", "månad"] });
    expect(col(r.table, "år")).toEqual(["2026", "2026", "2026", "2026", null]);
    expect(col(r.table, "månad")).toEqual(["09", "09", "10", "09", null]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({
      sourceRow: 6,
      column: "p",
      value: "nonsens",
      severity: "error",
    });
  });

  it("splits 'Efternamn, Förnamn' into first and last", () => {
    const t = table(["namn"], [["Svensson, Anna"], ["Öberg,Karin Maria"], ["Bo"]]);
    const r = run(t, {
      op: "split",
      column: "namn",
      mode: "last_first",
      into: ["förnamn", "efternamn"],
    });
    expect(col(r.table, "förnamn")).toEqual(["Anna", "Karin Maria", "Bo"]);
    expect(col(r.table, "efternamn")).toEqual(["Svensson", "Öberg", null]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.severity).toBe("warning");
  });

  it("refuses target names that collide", () => {
    const r = run(table(["u", "nr"], [["a-b", 1]]), {
      op: "split",
      column: "u",
      mode: "delimiter",
      delimiter: "-",
      into: ["nr", "x"],
    });
    expect(r.issues[0]!.message).toMatch(/finns redan/);
  });
});

describe("replace", () => {
  const t = table(["v"], [["Rusta och matcha"], ["RUSTA OCH MATCHA 2"], ["KROM"], [null], [12]]);

  it("replaces inside cells case-insensitively by default", () => {
    const r = run(t, {
      op: "replace",
      column: "v",
      find: "rusta och matcha",
      replace: "ROM",
      match: "contains",
    });
    expect(col(r.table, "v")).toEqual(["ROM", "ROM 2", "KROM", null, 12]);
  });

  it("respects caseSensitive", () => {
    const r = run(t, {
      op: "replace",
      column: "v",
      find: "rusta",
      replace: "x",
      match: "contains",
      caseSensitive: true,
    });
    expect(col(r.table, "v")).toEqual(["Rusta och matcha", "RUSTA OCH MATCHA 2", "KROM", null, 12]);
  });

  it("whole_cell only replaces exact (trimmed) matches; empty find matches empty cells", () => {
    const r = run(t, {
      op: "replace",
      column: "v",
      find: "krom",
      replace: "KROM-programmet",
      match: "whole_cell",
    });
    expect(col(r.table, "v")).toEqual([
      "Rusta och matcha",
      "RUSTA OCH MATCHA 2",
      "KROM-programmet",
      null,
      12,
    ]);
    const e = run(t, {
      op: "replace",
      column: "v",
      find: "",
      replace: "Okänd",
      match: "whole_cell",
    });
    expect(col(e.table, "v")[3]).toBe("Okänd");
  });

  it("treats regex characters literally and $ in the replacement literally", () => {
    const r = run(table(["v"], [["a.b (c)"]]), {
      op: "replace",
      column: "v",
      find: ".b (c)",
      replace: "$1",
      match: "contains",
    });
    expect(col(r.table, "v")).toEqual(["a$1"]);
  });

  it("matches numbers by their text and replacing with '' gives null", () => {
    const r = run(t, { op: "replace", column: "v", find: "12", replace: "", match: "whole_cell" });
    expect(col(r.table, "v")[4]).toBeNull();
  });

  it("warns and skips on an empty contains search", () => {
    const r = run(t, { op: "replace", column: "v", find: "", replace: "x", match: "contains" });
    expect(r.table).toBe(t);
    expect(r.issues[0]!.severity).toBe("warning");
  });
});

describe("clean", () => {
  it("parses amounts, keeping unparseable cells with an error issue", () => {
    const t = table(["b"], [["1 200 kr"], ["2,4 tkr"], ["-"], [500], ["abc"], [null]]);
    const r = run(t, { op: "clean", column: "b", as: "amount" });
    expect(col(r.table, "b")).toEqual([1200, 2400, null, 500, "abc", null]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({
      sourceRow: 6,
      column: "b",
      value: "abc",
      severity: "error",
    });
  });

  it("parses hours and percent", () => {
    expect(
      col(
        run(table(["h"], [["8,5 h"], ["7:45"]]), { op: "clean", column: "h", as: "hours" }).table,
        "h",
      ),
    ).toEqual([8.5, 7.75]);
    expect(
      col(run(table(["p"], [["12,5 %"]]), { op: "clean", column: "p", as: "percent" }).table, "p"),
    ).toEqual([12.5]);
  });

  it("uses the column's decimal separator to resolve ambiguous values", () => {
    const r = run(table(["n"], [["1.234"], ["12,5"]]), { op: "clean", column: "n", as: "number" });
    expect(col(r.table, "n")).toEqual([1234, 12.5]);
    expect(r.issues).toEqual([]);
  });

  it("reports ambiguous values instead of guessing", () => {
    const r = run(table(["n"], [["1.234"], ["999"]]), { op: "clean", column: "n", as: "number" });
    expect(col(r.table, "n")).toEqual(["1.234", 999]);
    expect(r.issues[0]!.message).toMatch(/Tvetydigt/);
  });

  it("trim collapses whitespace and empties to null", () => {
    const r = run(table(["t"], [["  Acme   AB "], ["   "], [5]]), {
      op: "clean",
      column: "t",
      as: "trim",
    });
    expect(col(r.table, "t")).toEqual(["Acme AB", null, 5]);
  });
});

describe("lookup", () => {
  it("maps aliases to canonical labels and reports unknown values", () => {
    const t = table(
      ["v"],
      [
        ["Rusta och matcha 2"],
        ["KROM"],
        ["krom"],
        ["Stöd & matchning"],
        ["Okänt program"],
        [null],
        ["Okänt program"],
      ],
    );
    const r = run(t, { op: "lookup", column: "v", dimension: "verksamhet" });
    expect(col(r.table, "v")).toEqual([
      "ROM2",
      "KROM",
      "KROM",
      "Stöd och matchning",
      "Okänt program",
      null,
      "Okänt program",
    ]);
    expect(r.unknown).toEqual({ verksamhet: ["Okänt program"] });
  });

  it("keeps canonical labels even when no alias equals them", () => {
    const r = applyStep(
      table(["v"], [["Stöd och matchning"], ["stöd och matchning"]]),
      step({ op: "lookup", column: "v", dimension: "verksamhet" }),
      ctx,
      0,
    );
    expect(col(r.table, "v")).toEqual(["Stöd och matchning", "Stöd och matchning"]);
    expect(r.unknown).toEqual({});
  });

  it("treats every value as unknown for a dimension without aliases", () => {
    const r = run(table(["v"], [["Malmö"]]), { op: "lookup", column: "v", dimension: "ort" });
    expect(r.unknown).toEqual({ ort: ["Malmö"] });
    expect(col(r.table, "v")).toEqual(["Malmö"]);
  });

  it("is safe against prototype keys", () => {
    const r = run(table(["v"], [["__proto__"], ["constructor"]]), {
      op: "lookup",
      column: "v",
      dimension: "verksamhet",
    });
    expect(col(r.table, "v")).toEqual(["__proto__", "constructor"]);
    expect(r.unknown).toEqual({ verksamhet: ["__proto__", "constructor"] });
  });
});

describe("filter", () => {
  const t = table(
    ["s", "n"],
    [
      ["Attesterad", 8],
      ["Ej attesterad", 0],
      ["", 3],
      ["attesterad", 8.5],
      [null, null],
    ],
  );

  it("removes matching rows and reports them", () => {
    const r = run(t, { op: "filter", column: "s", operator: "equals", value: "attesterad" });
    expect(col(r.table, "s")).toEqual(["Ej attesterad", "", null]);
    expect(r.skipped).toEqual([
      { sourceRow: 2, reason: "filtered", detail: 'Steg 1: s är "attesterad"' },
      { sourceRow: 5, reason: "filtered", detail: 'Steg 1: s är "attesterad"' },
    ]);
  });

  it("supports not_equals, contains, empty and not_empty", () => {
    expect(
      col(
        run(t, { op: "filter", column: "s", operator: "not_equals", value: "Attesterad" }).table,
        "s",
      ),
    ).toEqual(["Attesterad", "attesterad"]);
    expect(
      col(run(t, { op: "filter", column: "s", operator: "contains", value: "EJ" }).table, "s"),
    ).toEqual(["Attesterad", "", "attesterad", null]);
    expect(col(run(t, { op: "filter", column: "s", operator: "empty" }).table, "s")).toEqual([
      "Attesterad",
      "Ej attesterad",
      "attesterad",
    ]);
    expect(col(run(t, { op: "filter", column: "s", operator: "not_empty" }).table, "s")).toEqual([
      "",
      null,
    ]);
  });

  it("is case-sensitive when asked", () => {
    const r = run(t, {
      op: "filter",
      column: "s",
      operator: "equals",
      value: "attesterad",
      caseSensitive: true,
    });
    expect(col(r.table, "s")).toEqual(["Attesterad", "Ej attesterad", "", null]);
  });

  it("compares numbers numerically (Swedish decimal comma)", () => {
    const r = run(t, { op: "filter", column: "n", operator: "equals", value: "8,5" });
    expect(col(r.table, "n")).toEqual([8, 0, 3, null]);
  });

  it("needs a value for equals/contains", () => {
    expect(run(t, { op: "filter", column: "s", operator: "equals" }).issues[0]!.message).toMatch(
      /saknas/,
    );
    expect(
      run(t, { op: "filter", column: "s", operator: "contains", value: "" }).issues,
    ).toHaveLength(1);
  });
});

describe("reorder", () => {
  it("puts listed columns first and keeps the rest in order", () => {
    const t = table(["a", "b", "c", "d"], [[1, 2, 3, 4]]);
    const r = run(t, { op: "reorder", order: ["c", "a"] });
    expect(r.table.columns).toEqual(["c", "a", "b", "d"]);
    // Only the column order changes; the row data is shared, not copied.
    expect(r.table.rows).toBe(t.rows);
  });

  it("refuses duplicates", () => {
    const r = run(table(["a", "b"], [[1, 2]]), { op: "reorder", order: ["a", "a"] });
    expect(r.issues[0]!.message).toMatch(/flera gånger/);
  });
});

describe("unpivot", () => {
  it("turns wide month columns into rows with the header text", () => {
    const t = table(
      ["konto", "jan", "feb", "mar"],
      [
        ["3010", 100, 200, null],
        ["4010", 50, "", 70],
      ],
      { konto: "Konto", jan: "Jan 2026", feb: "Feb 2026", mar: "Mar 2026" },
    );
    const r = run(t, {
      op: "unpivot",
      columns: ["jan", "feb", "mar"],
      nameColumn: "månad",
      valueColumn: "belopp",
    });
    expect(r.table.columns).toEqual(["konto", "månad", "belopp"]);
    expect(r.table.rows).toEqual([
      { sourceRow: 2, values: { konto: "3010", månad: "Jan 2026", belopp: 100 } },
      { sourceRow: 2, values: { konto: "3010", månad: "Feb 2026", belopp: 200 } },
      { sourceRow: 3, values: { konto: "4010", månad: "Jan 2026", belopp: 50 } },
      { sourceRow: 3, values: { konto: "4010", månad: "Mar 2026", belopp: 70 } },
    ]);
    expect(r.table.headers).toEqual({ konto: "Konto", månad: "månad", belopp: "belopp" });
  });

  it("uses the working name when there is no header text", () => {
    const r = run(table(["k", "krom"], [["a", 1]]), {
      op: "unpivot",
      columns: ["krom"],
      nameColumn: "v",
      valueColumn: "n",
    });
    expect(r.table.rows[0]!.values).toEqual({ k: "a", v: "krom", n: 1 });
  });

  it("refuses name/value columns that collide with kept columns", () => {
    const r = run(table(["k", "x"], [["a", 1]]), {
      op: "unpivot",
      columns: ["x"],
      nameColumn: "k",
      valueColumn: "v",
    });
    expect(r.issues[0]!.message).toMatch(/finns redan/);
  });
});

describe("fill_down", () => {
  it("fills empty cells with the value above", () => {
    const r = run(table(["k"], [[null], ["Acme"], [null], [""], ["Beta"], [null]]), {
      op: "fill_down",
      column: "k",
    });
    expect(col(r.table, "k")).toEqual([null, "Acme", "Acme", "Acme", "Beta", "Beta"]);
  });
});

describe("negate", () => {
  it("negates numbers and numeric text, never producing -0", () => {
    const r = run(table(["b"], [[100], [-5], [0], ["1 200"], ["-"], [null], ["x"], [true]]), {
      op: "negate",
      column: "b",
    });
    const values = col(r.table, "b");
    expect(values).toEqual([-100, 5, 0, -1200, null, null, "x", true]);
    expect(Object.is(values[2], 0)).toBe(true);
    expect(r.issues.map((i) => i.sourceRow)).toEqual([8, 9]);
  });
});

describe("constant", () => {
  it("adds a column with a fixed value", () => {
    const r = run(table(["a"], [[1], [2]], { a: "A" }), {
      op: "constant",
      column: "verksamhet",
      value: "Bemanning",
    });
    expect(r.table.columns).toEqual(["a", "verksamhet"]);
    expect(col(r.table, "verksamhet")).toEqual(["Bemanning", "Bemanning"]);
    expect(r.table.headers).toEqual({ a: "A", verksamhet: "verksamhet" });
  });

  it("refuses an existing column", () => {
    const r = run(table(["a"], [[1]]), { op: "constant", column: "a", value: "x" });
    expect(r.issues[0]!.message).toMatch(/finns redan/);
  });
});

describe("unknown operations", () => {
  it("are reported and skipped", () => {
    const t = table(["a"], [[1]]);
    const r = applyStep(t, { op: "explode" } as unknown as Step, ctx, 2);
    expect(r.table).toBe(t);
    expect(r.issues[0]!.message).toMatch(/Steg 3: okänd operation "explode"/);
  });

  it("treat Object.prototype names as unknown instead of crashing", () => {
    const t = table(["a"], [[1]]);
    for (const op of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      const r = applyStep(t, { op } as unknown as Step, ctx, 0);
      expect(r.table).toBe(t);
      expect(r.issues[0]!.message).toMatch(/okänd operation/);
    }
  });
});
