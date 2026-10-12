import { describe, expect, it } from "vitest";
import type { UrlFilters } from "@/lib/app/filters";
import {
  buildBreadcrumbs,
  defaultBreakdown,
  drillInto,
  suggestNextDimension,
  usedDimensions,
} from "./drill";
import { parseExploreState, type ExploreState } from "./explore-state";

const IP_TIMMAR = ["kund", "uppdrag", "konsult", "verksamhet"];
const LEDGER = ["kostnadsstalle"];
const DELTAGARE = ["verksamhet", "ort", "resultattyp"];
const ALL: UrlFilters = { company: "ALL", grain: "month", anchor: null };

describe("next breakdown suggestion", () => {
  it("follows bolag → verksamhet/kostnadsställe → kund → uppdrag → konsult", () => {
    const none = new Set<string>();
    expect(suggestNextDimension(null, IP_TIMMAR, none)).toBe("bolag");
    expect(suggestNextDimension("bolag", IP_TIMMAR, none)).toBe("verksamhet");
    expect(suggestNextDimension("verksamhet", IP_TIMMAR, none)).toBe("kund");
    expect(suggestNextDimension("kund", IP_TIMMAR, none)).toBe("uppdrag");
    expect(suggestNextDimension("uppdrag", IP_TIMMAR, none)).toBe("konsult");
    expect(suggestNextDimension("konsult", IP_TIMMAR, none)).toBeNull();
  });

  it("skips dimensions the metric lacks or the drill path already uses", () => {
    expect(suggestNextDimension("bolag", LEDGER, new Set())).toBe("kostnadsstalle");
    expect(suggestNextDimension("kostnadsstalle", LEDGER, new Set())).toBeNull();
    expect(suggestNextDimension("bolag", ["kund", "uppdrag", "konsult"], new Set())).toBe("kund");
    expect(suggestNextDimension(null, IP_TIMMAR, new Set(["bolag", "verksamhet"]))).toBe("kund");
  });

  it("continues with dimensions outside the chain", () => {
    expect(suggestNextDimension("verksamhet", DELTAGARE, new Set())).toBe("ort");
    expect(suggestNextDimension("ort", DELTAGARE, new Set())).toBe("resultattyp");
    expect(suggestNextDimension("resultattyp", DELTAGARE, new Set(["ort"]))).toBeNull();
  });

  it("defaults to bolag, then the next step after the drill path, then per month", () => {
    expect(defaultBreakdown("ALL", [], IP_TIMMAR)).toBe("bolag");
    expect(defaultBreakdown("MBAB", [], IP_TIMMAR)).toBe("verksamhet");
    expect(defaultBreakdown("MBAB", [{ dimension: "kund", valueId: 1 }], IP_TIMMAR)).toBe(
      "uppdrag",
    );
    expect(defaultBreakdown("MBAB", [{ dimension: "kostnadsstalle", valueId: 1 }], LEDGER)).toBe(
      "manad",
    );
    expect(usedDimensions("MBR", [{ dimension: "kund", valueId: 1 }])).toEqual(
      new Set(["kund", "bolag"]),
    );
  });
});

describe("drilling into a row", () => {
  const base: ExploreState = {
    metrics: ["timmar"],
    groupBy: "bolag",
    filters: [],
    sort: { key: "m0", dir: "asc" },
  };

  it("a company row sets the company filter and suggests the next breakdown", () => {
    const r = drillInto(base, ALL, { kind: "company", company: "MBAB" }, IP_TIMMAR);
    expect(r?.filters.company).toBe("MBAB");
    expect(r?.state).toEqual({ ...base, groupBy: "verksamhet", sort: null });
    expect(drillInto(base, ALL, { kind: "company", company: "XX" }, IP_TIMMAR)).toBeNull();
  });

  it("a value row adds a filter (replacing one on the same dimension)", () => {
    const state = { ...base, groupBy: "kund", filters: [{ dimension: "verksamhet", valueId: 4 }] };
    const r = drillInto(
      state,
      { ...ALL, company: "MBAB" },
      { kind: "value", dimension: "kund", valueId: 101 },
      IP_TIMMAR,
    );
    expect(r?.state.filters).toEqual([
      { dimension: "verksamhet", valueId: 4 },
      { dimension: "kund", valueId: 101 },
    ]);
    expect(r?.state.groupBy).toBe("uppdrag");
    const again = drillInto(
      r!.state,
      r!.filters,
      { kind: "value", dimension: "kund", valueId: 102 },
      IP_TIMMAR,
    );
    expect(again?.state.filters.filter((f) => f.dimension === "kund")).toEqual([
      { dimension: "kund", valueId: 102 },
    ]);
  });

  it("the last level drills into a per-month view", () => {
    const state = {
      ...base,
      groupBy: "konsult",
      filters: [
        { dimension: "kund", valueId: 1 },
        { dimension: "uppdrag", valueId: 2 },
      ],
    };
    const r = drillInto(
      state,
      { ...ALL, company: "MBAB" },
      { kind: "value", dimension: "konsult", valueId: 3 },
      IP_TIMMAR,
    );
    expect(r?.state.groupBy).toBe("manad");
  });

  it("a month row anchors the period on that month", () => {
    const r = drillInto(
      { ...base, groupBy: "manad" },
      { ...ALL, grain: "ytd" },
      { kind: "month", month: "2026-03" },
      IP_TIMMAR,
    );
    expect(r?.filters).toEqual({ company: "ALL", grain: "month", anchor: "2026-03" });
    expect(r?.state.groupBy).toBe("bolag");
    expect(drillInto(base, ALL, { kind: "month", month: "2026-13" }, IP_TIMMAR)).toBeNull();
  });
});

describe("breadcrumb", () => {
  const labels: Record<string, string> = {
    "verksamhet.4": "Bemanning",
    "kund.101": "Budbee Södertälje",
  };
  const labelOf = (f: { dimension: string; valueId: number }) =>
    labels[`${f.dimension}.${f.valueId}`] ?? "?";

  it("lists Summa bolag › company › each drilled value; the last crumb is current", () => {
    const state = parseExploreState(
      new URLSearchParams("matt=timmar&grupp=uppdrag&f=verksamhet.4&f=kund.101"),
    );
    const crumbs = buildBreadcrumbs(state, { ...ALL, company: "MBAB" }, labelOf);
    expect(crumbs.map((c) => c.label)).toEqual([
      "Summa bolag",
      "MB AB",
      "Bemanning",
      "Budbee Södertälje",
    ]);
    expect(crumbs.at(-1)?.href).toBeNull();
    // Going back restores the breakdown that was used at that level.
    expect(crumbs[0]?.href).toBe("/utforska?matt=timmar&grupp=bolag");
    expect(crumbs[1]?.href).toBe("/utforska?bolag=MBAB&matt=timmar&grupp=verksamhet");
    expect(crumbs[2]?.href).toBe("/utforska?bolag=MBAB&matt=timmar&grupp=kund&f=verksamhet.4");
  });

  it("is a single current crumb at the top level", () => {
    const crumbs = buildBreadcrumbs(
      { metrics: ["timmar"], groupBy: "bolag", filters: [], sort: null },
      ALL,
      labelOf,
    );
    expect(crumbs).toEqual([{ label: "Summa bolag", href: null }]);
  });

  it("without a company the root goes back to the first drilled breakdown", () => {
    const state = parseExploreState(new URLSearchParams("matt=timmar&grupp=uppdrag&f=kund.101"));
    const crumbs = buildBreadcrumbs(state, ALL, labelOf);
    expect(crumbs.map((c) => c.label)).toEqual(["Summa bolag", "Budbee Södertälje"]);
    expect(crumbs[0]?.href).toBe("/utforska?matt=timmar&grupp=kund");
  });
});
