import { describe, expect, it } from "vitest";
import {
  EMPTY_EXPLORE_STATE,
  MAX_METRICS,
  entityHref,
  exploreHref,
  parseExploreState,
  toggleSort,
  withExploreState,
} from "./explore-state";

describe("explore state in the URL", () => {
  it("parses metrics, breakdown, drill filters and sort", () => {
    const state = parseExploreState(
      new URLSearchParams(
        "matt=konsulter,timmar&grupp=kund&f=verksamhet.6&f=kund.42&sort=m0&dir=asc",
      ),
    );
    expect(state).toEqual({
      metrics: ["konsulter", "timmar"],
      groupBy: "kund",
      filters: [
        { dimension: "verksamhet", valueId: 6 },
        { dimension: "kund", valueId: 42 },
      ],
      sort: { key: "m0", dir: "asc" },
    });
  });

  it("accepts record params with repeated values", () => {
    const state = parseExploreState({
      matt: ["timmar", "pass,timmar"],
      f: ["kund.1", "uppdrag.2"],
    });
    expect(state.metrics).toEqual(["timmar", "pass"]);
    expect(state.filters.map((f) => f.dimension)).toEqual(["kund", "uppdrag"]);
  });

  it("drops junk instead of failing", () => {
    const state = parseExploreState(
      new URLSearchParams(
        "matt=Timmar,1x,,ok_key&grupp=DROP;TABLE&f=kund.0&f=kund&f=x.5&f=kund.7&f=kund.8&sort=<script>&dir=up",
      ),
    );
    expect(state.metrics).toEqual(["ok_key"]);
    expect(state.groupBy).toBeNull();
    // x is too short for a dimension key; the second kund filter is ignored (one per dimension).
    expect(state.filters).toEqual([{ dimension: "kund", valueId: 7 }]);
    expect(state.sort).toBeNull();
    expect(parseExploreState({})).toEqual(EMPTY_EXPLORE_STATE);
  });

  it("caps the number of metrics", () => {
    const keys = Array.from({ length: 10 }, (_, i) => `mm${i}`);
    expect(parseExploreState({ matt: keys.join(",") }).metrics).toHaveLength(MAX_METRICS);
  });

  it("round-trips and keeps global filters", () => {
    const state = {
      metrics: ["timmar", "faktor"],
      groupBy: "uppdrag",
      filters: [{ dimension: "kund", valueId: 42 }],
      sort: { key: "label", dir: "asc" as const },
    };
    const params = withExploreState(state, new URLSearchParams("bolag=MBAB&matt=old&f=x.1"));
    expect(params.get("bolag")).toBe("MBAB");
    expect(parseExploreState(params)).toEqual(state);
  });

  it("builds links into Utforska and entity pages", () => {
    const filters = { company: "MBAB" as const, grain: "ytd" as const, anchor: "2026-09" };
    expect(exploreHref({ metrics: ["timmar"], groupBy: "kund" }, filters)).toBe(
      "/utforska?bolag=MBAB&period=ytd&manad=2026-09&matt=timmar&grupp=kund",
    );
    expect(exploreHref({}, { company: "ALL", grain: "month", anchor: null })).toBe("/utforska");
    expect(entityHref("kund", 42, filters, { groupBy: "konsult" })).toBe(
      "/utforska/kund/42?bolag=MBAB&period=ytd&manad=2026-09&grupp=konsult",
    );
  });

  it("toggles sort direction on the active column", () => {
    expect(toggleSort(null, "m0")).toEqual({ key: "m0", dir: "desc" });
    expect(toggleSort(null, "label")).toEqual({ key: "label", dir: "asc" });
    expect(toggleSort({ key: "m0", dir: "desc" }, "m0")).toEqual({ key: "m0", dir: "asc" });
    expect(toggleSort({ key: "m0", dir: "asc" }, "m1")).toEqual({ key: "m1", dir: "desc" });
  });
});
