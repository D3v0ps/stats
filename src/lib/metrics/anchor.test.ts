import { describe, expect, it } from "vitest";
import { pickAnchorMonth } from "./anchor";

describe("pickAnchorMonth", () => {
  const required = ["resultat", "aktiva_deltagare", "timmar"];
  it("picks the latest month where every key metric has data", () => {
    const coverage = {
      resultat: ["2026-07", "2026-08"],
      aktiva_deltagare: ["2026-07", "2026-08", "2026-09"],
      timmar: ["2026-08", "2026-09"],
    };
    expect(pickAnchorMonth(coverage, required, "2026-09")).toEqual({
      month: "2026-08",
      complete: true,
    });
  });
  it("never picks a month that has not ended", () => {
    const coverage = { resultat: ["2026-10"], aktiva_deltagare: ["2026-10"], timmar: ["2026-10"] };
    expect(pickAnchorMonth(coverage, required, "2026-09")).toEqual({
      month: "2026-09",
      complete: false,
    });
  });
  it("falls back to the latest partial month, then to the last closed month", () => {
    expect(pickAnchorMonth({ timmar: ["2026-06"] }, required, "2026-09")).toEqual({
      month: "2026-06",
      complete: false,
    });
    expect(pickAnchorMonth({}, required, "2026-09")).toEqual({ month: "2026-09", complete: false });
  });
});
