import { describe, expect, it } from "vitest";
import { CATALOG_ACCOUNT_GROUPS, CATALOG_METRICS } from "@/lib/contracts/catalog";
import { catalogAccountGroups, catalogDefinitions } from "./catalog";

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

  it("copies the account groups", () => {
    const groups = catalogAccountGroups();
    expect(groups).toEqual(CATALOG_ACCOUNT_GROUPS);
    expect(groups[0]?.ranges).not.toBe(CATALOG_ACCOUNT_GROUPS[0]?.ranges);
  });
});
