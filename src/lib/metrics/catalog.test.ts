import { describe, expect, it } from "vitest";
import { CATALOG_ACCOUNT_GROUPS, CATALOG_METRICS } from "@/lib/contracts/catalog";
import { catalogAccountGroups, catalogDefinitions } from "./catalog";
import { leafAccountGroups, rangesCover } from "./memory-source";

describe("catalogDefinitions", () => {
  const defs = new Map(catalogDefinitions().map((d) => [d.key, d]));

  it("maps every seeded metric", () => {
    expect(defs.size).toBe(CATALOG_METRICS.length);
    expect(defs.get("konsulter")).toMatchObject({
      kind: "distinct",
      baseMetricKey: "timmar",
      distinctDimension: "konsult",
      headlineSubject: "KONSULTERNA",
    });
    expect(defs.get("aktiva_deltagare")?.snapshotRollup).toBe("last");
    expect(defs.get("timmar")?.snapshotRollup).toBeNull();
  });

  it("gives metrics their dataset's dimensions", () => {
    expect(defs.get("timmar")?.dimensions).toEqual(["kund", "uppdrag", "konsult", "verksamhet"]);
    expect(defs.get("resultat")?.dimensions).toEqual(["kostnadsstalle"]);
    expect(defs.get("budget_belopp")?.dimensions).toEqual(["kontogrupp", "kostnadsstalle"]);
  });

  it("gives formula metrics the intersection of their operands' dimensions", () => {
    expect(defs.get("faktor")?.dimensions).toEqual(["kund", "uppdrag", "konsult"]);
    expect(defs.get("sjukfranvaro")?.dimensions).toEqual(["kund", "uppdrag", "konsult"]);
    expect(defs.get("resultatmarginal")?.dimensions).toEqual(["kostnadsstalle"]);
    expect(defs.get("resultatandel")?.dimensions).toEqual(["verksamhet", "ort", "resultattyp"]);
  });

  it("has a ledger metric for övriga rörelsekostnader", () => {
    expect(defs.get("ovriga_rorelse")).toMatchObject({
      kind: "ledger",
      accountGroupKey: "ovriga_rorelse",
      datasetKey: "fx_bokforing",
      name: "Övriga rörelsekostnader",
      unit: "kr",
      higherIsBetter: false,
      headlineSubject: "DE ÖVRIGA RÖRELSEKOSTNADERNA",
      description: "Konto 7900–7999.",
    });
  });

  it("tiles kostnader and resultat with leaf groups, so their budgets miss no account", () => {
    const groups = catalogAccountGroups();
    const leaves = leafAccountGroups(groups);
    expect(leaves.map((g) => g.key)).toContain("ovriga_rorelse");
    for (const key of ["kostnader", "resultat"]) {
      const group = groups.find((g) => g.key === key)!;
      const inside = leaves.filter((l) => rangesCover(group.ranges, l.ranges));
      expect(
        rangesCover(
          inside.flatMap((l) => l.ranges),
          group.ranges,
        ),
        key,
      ).toBe(true);
    }
  });

  it("copies the account groups", () => {
    const groups = catalogAccountGroups();
    expect(groups).toEqual(CATALOG_ACCOUNT_GROUPS);
    expect(groups[0]?.ranges).not.toBe(CATALOG_ACCOUNT_GROUPS[0]?.ranges);
  });
});
