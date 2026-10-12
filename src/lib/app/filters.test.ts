import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, parseUrlFilters, withUrlFilters } from "./filters";

describe("url filters", () => {
  it("parses valid params and falls back on junk", () => {
    expect(parseUrlFilters({ bolag: "mbr", period: "ytd", manad: "2026-09" })).toEqual({
      company: "MBR",
      grain: "ytd",
      anchor: "2026-09",
    });
    expect(parseUrlFilters({ bolag: "X", period: "week", manad: "2026-13" })).toEqual(
      DEFAULT_FILTERS,
    );
    expect(parseUrlFilters(new URLSearchParams("period=r12"))).toMatchObject({ grain: "r12" });
  });
  it("serializes without defaults and keeps other params", () => {
    const params = withUrlFilters(
      { company: "ALL", grain: "quarter", anchor: "2026-09" },
      new URLSearchParams("matt=timmar&bolag=MBAB"),
    );
    expect(params.toString()).toBe("matt=timmar&period=quarter&manad=2026-09");
  });
});
