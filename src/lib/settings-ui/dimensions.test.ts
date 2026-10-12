import { describe, expect, it } from "vitest";
import {
  aliasCountLabel,
  applyValuePatch,
  buildValueRows,
  filterValueRows,
  valueCountLabel,
} from "./dimensions";

const values = [
  { id: 3, code: "ikea", label: "IKEA", sort: 0, active: true },
  { id: 1, code: "volvo ab", label: "Volvo AB", sort: 0, active: true },
  { id: 2, code: "åhléns", label: "Åhléns", sort: 0, active: true },
  { id: 4, code: "gamla", label: "Gamla kunden", sort: 0, active: false },
  { id: 5, code: "först", label: "Först", sort: -1, active: true },
];
const aliases = [
  { aliasNorm: "volvo", valueId: 1 },
  { aliasNorm: "k-100", valueId: 1 },
];

describe("buildValueRows", () => {
  it("sorts active first, then by sort and Swedish collation, with aliases attached", () => {
    const rows = buildValueRows(values, aliases);
    expect(rows.map((r) => r.label)).toEqual([
      "Först",
      "IKEA",
      "Volvo AB",
      "Åhléns",
      "Gamla kunden",
    ]);
    expect(rows.find((r) => r.id === 1)?.aliases).toEqual(["k-100", "volvo"]);
    expect(rows.find((r) => r.id === 3)?.aliases).toEqual([]);
  });
});

describe("filterValueRows", () => {
  const rows = buildValueRows(values, aliases);

  it("matches label, code and aliases, normalized", () => {
    expect(filterValueRows(rows, "  VOL ", { showInactive: false }).map((r) => r.id)).toEqual([1]);
    expect(filterValueRows(rows, "k-1", { showInactive: false }).map((r) => r.id)).toEqual([1]);
    expect(filterValueRows(rows, "åhl", { showInactive: false }).map((r) => r.id)).toEqual([2]);
  });

  it("hides inactive values unless asked", () => {
    expect(filterValueRows(rows, "", { showInactive: false })).toHaveLength(4);
    expect(filterValueRows(rows, "gamla", { showInactive: false })).toEqual([]);
    expect(filterValueRows(rows, "gamla", { showInactive: true }).map((r) => r.id)).toEqual([4]);
  });
});

describe("applyValuePatch", () => {
  const rows = buildValueRows(values, aliases);

  it("renames, toggles and edits aliases", () => {
    expect(
      applyValuePatch(rows, { kind: "label", id: 3, label: "Ikea AB" }).find((r) => r.id === 3)
        ?.label,
    ).toBe("Ikea AB");
    expect(
      applyValuePatch(rows, { kind: "active", id: 3, active: false }).find((r) => r.id === 3)
        ?.active,
    ).toBe(false);
    const moved = applyValuePatch(rows, { kind: "alias_add", id: 3, alias: " VOLVO " });
    expect(moved.find((r) => r.id === 3)?.aliases).toEqual(["volvo"]);
    expect(moved.find((r) => r.id === 1)?.aliases).toEqual(["k-100"]);
    const removed = applyValuePatch(rows, { kind: "alias_remove", alias: "K-100" });
    expect(removed.find((r) => r.id === 1)?.aliases).toEqual(["volvo"]);
  });

  it("merges like the database does", () => {
    const merged = applyValuePatch(rows, { kind: "merge", fromId: 1, intoId: 3 });
    expect(merged.find((r) => r.id === 1)).toMatchObject({ active: false, aliases: [] });
    expect(merged.find((r) => r.id === 3)?.aliases).toEqual(["k-100", "volvo", "volvo ab"]);
    expect(applyValuePatch(rows, { kind: "merge", fromId: 99, intoId: 3 })).toEqual(rows);
  });
});

describe("labels", () => {
  it("pluralizes and formats counts", () => {
    expect(valueCountLabel(1)).toBe("1 aktivt värde");
    expect(valueCountLabel(1234)).toBe("1 234 aktiva värden");
    expect(aliasCountLabel(1)).toBe("1 alias");
    expect(aliasCountLabel(0)).toBe("0 alias");
  });
});
