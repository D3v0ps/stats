import { describe, expect, it } from "vitest";
import type { DetectedTable, RawCell } from "@/lib/contracts/workbook";
import { cellText } from "@/lib/ingest";
import {
  canCreateValues,
  checkSingleAlias,
  cleanText,
  defaultMode,
  extractPairs,
  importOperations,
  planAliasImport,
  type PlanContext,
} from "./alias-import";

const kund: PlanContext = {
  dimensionKey: "kund",
  policy: "ask",
  values: [
    { id: 1, code: "volvo ab", label: "Volvo AB", sort: 0, active: true },
    { id: 2, code: "ikea", label: "IKEA", sort: 0, active: true },
    { id: 3, code: "gamla kunden", label: "Gamla kunden", sort: 0, active: false },
  ],
  aliases: [{ aliasNorm: "k-100", valueId: 1 }],
};

const konsult: PlanContext = {
  dimensionKey: "konsult",
  policy: "auto_create",
  values: [
    { id: 10, code: "1001", label: "1001", sort: 0, active: true },
    { id: 11, code: "1002", label: "Bo Berg", sort: 0, active: true },
  ],
  aliases: [],
};

const pair = (row: number, from: string, to: string) => ({ row, from, to });

describe("planAliasImport – alias mode", () => {
  it("classifies every row", () => {
    const plan = planAliasImport(
      [
        pair(2, "K-200", "IKEA"),
        pair(3, "k-100", "Volvo AB"),
        pair(4, "K-100", "ikea"),
        pair(5, "Volvo", "Saab"),
        pair(6, "IKEA", "Volvo AB"),
        pair(7, "", "IKEA"),
        pair(8, "K-200", "IKEA"),
        pair(9, "K-200", "Volvo AB"),
        pair(10, "Kund 640823-3234", "IKEA"),
      ],
      "alias",
      kund,
    );
    expect(plan.rows.map((r) => [r.row, r.status, r.valueId])).toEqual([
      [2, "add_alias", 2],
      [3, "unchanged", 1],
      [4, "invalid", null],
      [5, "unknown_target", null],
      [6, "conflict", 1],
      [7, "invalid", null],
      [8, "duplicate", null],
      [9, "invalid", null],
      [10, "invalid", null],
    ]);
    expect(plan.rows[9 - 2]?.message).toMatch(/annat Till/);
    expect(plan.rows[10 - 2]?.message).toBe("Personnummer får inte sparas.");
    expect(plan.applicable).toBe(1);
    expect(plan.flagged).toBe(6);
    expect(plan.counts.add_alias).toBe(1);
  });

  it("moves an alias that points elsewhere", () => {
    const plan = planAliasImport([pair(2, "K-100", "IKEA")], "alias", kund);
    expect(plan.rows[0]).toMatchObject({ status: "move_alias", valueId: 2 });
    expect(plan.rows[0]?.message).toBe("Pekade på ”Volvo AB”, flyttas till ”IKEA”.");
  });

  it("refuses inactive targets but may repoint an inactive value's code", () => {
    const plan = planAliasImport(
      [pair(2, "GK", "Gamla kunden"), pair(3, "gamla kunden", "IKEA")],
      "alias",
      kund,
    );
    expect(plan.rows[0]).toMatchObject({ status: "unknown_target", valueId: null });
    expect(plan.rows[0]?.message).toBe("”Gamla kunden” är inaktiverat. Aktivera värdet först.");
    expect(plan.rows[1]).toMatchObject({ status: "add_alias", valueId: 2 });
    expect(checkSingleAlias("Gamla kunden", 2, kund).status).toBe("add");
  });

  it("creates targets for auto_create dimensions", () => {
    const plan = planAliasImport(
      [pair(2, "B. Berg", "Bo Berg"), pair(3, "C", "Cecilia Ek")],
      "alias",
      konsult,
    );
    expect(plan.rows.map((r) => r.status)).toEqual(["add_alias", "create_and_alias"]);
    expect(plan.applicable).toBe(2);
  });

  it("cleans whitespace before planning", () => {
    const plan = planAliasImport([pair(2, "  K-300 ", " IKEA ")], "alias", kund);
    expect(plan.rows[0]).toMatchObject({ from: "K-300", to: "IKEA", status: "add_alias" });
  });
});

describe("planAliasImport – relabel mode", () => {
  it("renames existing values and creates unknown ones", () => {
    const plan = planAliasImport(
      [pair(2, "1001", "Anna Andersson"), pair(3, "1002", "Bo Berg"), pair(4, "1003", "Cia Dahl")],
      "relabel",
      konsult,
    );
    expect(plan.rows.map((r) => [r.status, r.valueId])).toEqual([
      ["relabel", 10],
      ["unchanged", 11],
      ["create_value", null],
    ]);
    expect(plan.rows[0]?.message).toBe("”1001” byter namn till ”Anna Andersson”.");
  });

  it("finds inactive values by code instead of creating a clashing one", () => {
    const withInactive: PlanContext = {
      ...konsult,
      values: [...konsult.values, { id: 12, code: "1005", label: "1005", sort: 0, active: false }],
    };
    const plan = planAliasImport([pair(2, "1005", "Eva Ek")], "relabel", withInactive);
    expect(plan.rows[0]).toMatchObject({ status: "relabel", valueId: 12 });
  });

  it("flags unknown values when values cannot be created", () => {
    const plan = planAliasImport([pair(2, "K-999", "Nytt namn")], "relabel", kund);
    expect(plan.rows[0]?.status).toBe("unknown_target");
    expect(canCreateValues({ dimensionKey: "kostnadsstalle", policy: "auto_create" })).toBe(false);
  });

  it("treats a repeated id with another name as invalid", () => {
    const plan = planAliasImport(
      [pair(2, "1001", "Anna"), pair(3, "1001", "anna"), pair(4, "1001", "Anna")],
      "relabel",
      konsult,
    );
    expect(plan.rows.map((r) => r.status)).toEqual(["relabel", "invalid", "duplicate"]);
  });
});

describe("importOperations", () => {
  it("turns a plan into ordered writes", () => {
    const alias = planAliasImport(
      [pair(2, "B. Berg", "Bo Berg"), pair(3, "C", "Cia Ek"), pair(4, "C. Ek", "cia ek")],
      "alias",
      konsult,
    );
    expect(importOperations(alias)).toEqual({
      createTargets: ["Cia Ek", "cia ek"],
      aliases: [{ alias: "B. Berg", valueId: 11 }],
      aliasesToCreated: [
        { alias: "C", label: "Cia Ek" },
        { alias: "C. Ek", label: "cia ek" },
      ],
      relabels: [],
      creates: [],
    });
    const relabel = planAliasImport(
      [pair(2, "1001", "Anna"), pair(3, "1009", "Ny Person"), pair(4, "", "x")],
      "relabel",
      konsult,
    );
    expect(importOperations(relabel)).toEqual({
      createTargets: [],
      aliases: [],
      aliasesToCreated: [],
      relabels: [{ id: 10, label: "Anna" }],
      creates: [{ code: "1009", label: "Ny Person" }],
    });
  });
});

describe("checkSingleAlias", () => {
  it("adds, moves, keeps and refuses aliases like the bulk planner", () => {
    expect(checkSingleAlias("K-200", 2, kund).status).toBe("add");
    expect(checkSingleAlias(" k-100 ", 1, kund).status).toBe("unchanged");
    expect(checkSingleAlias("K-100", 2, kund)).toEqual({
      status: "move",
      message: "Aliaset flyttades från ”Volvo AB”.",
    });
    expect(checkSingleAlias("volvo ab", 1, kund).status).toBe("unchanged");
    expect(checkSingleAlias("IKEA", 1, kund).status).toBe("conflict");
    expect(checkSingleAlias("  ", 1, kund).status).toBe("invalid");
    expect(checkSingleAlias("640823-3234", 1, kund).message).toBe("Personnummer får inte sparas.");
  });
});

describe("file helpers", () => {
  const cell = (v: string | number | null): RawCell =>
    v === null ? { v: null, t: "z" } : typeof v === "number" ? { v, t: "n" } : { v, t: "s" };
  const table: DetectedTable = {
    sheetName: "Blad1",
    headerRows: [0],
    columns: [
      { index: 0, header: "Anställnings-id", normalized: "anställnings-id" },
      { index: 1, header: "Namn", normalized: "namn" },
    ],
    rows: [
      { sourceRow: 2, cells: [cell(1001), cell("Anna Andersson")] },
      { sourceRow: 3, cells: [cell(null), cell(null)] },
      { sourceRow: 4, cells: [cell(1002), cell(null)] },
    ],
    skipped: [],
    metaLines: [],
    confidence: 0.9,
  };

  it("extracts pairs from two columns, skipping empty rows", () => {
    expect(extractPairs(table, 0, 1, { cellText })).toEqual({
      pairs: [pair(2, "1001", "Anna Andersson"), pair(4, "1002", "")],
      emptyRows: 1,
    });
    expect(extractPairs(table, 1, 0, { cellText, headerIsData: true }).pairs[0]).toEqual(
      pair(1, "Namn", "Anställnings-id"),
    );
    expect(extractPairs(table, 0, 5, { cellText }).pairs).toEqual([]);
  });

  it("picks the default mode and cleans text", () => {
    expect(defaultMode("konsult")).toBe("relabel");
    expect(defaultMode("kund")).toBe("alias");
    expect(cleanText(" a​  b ")).toBe("a b");
  });
});
