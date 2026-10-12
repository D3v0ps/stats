import { describe, expect, it } from "vitest";
import { anchorHint, effectiveAnchor, hintCoverageRange, monthOptions } from "./period";

const NAMES = {
  resultat: "Resultat",
  aktiva_deltagare: "Aktiva deltagare",
  timmar: "Fakturerade timmar",
};
const full = (m: string) => ({ resultat: [m], aktiva_deltagare: [m], timmar: [m] });

describe("period helpers", () => {
  it("lists months newest first, including a selected older month", () => {
    const opts = monthOptions("2026-09", null, 3);
    expect(opts).toEqual([
      { value: "2026-09", label: "September 2026" },
      { value: "2026-08", label: "Augusti 2026" },
      { value: "2026-07", label: "Juli 2026" },
    ]);
    expect(monthOptions("2026-09", "2020-01", 2).map((o) => o.value)).toEqual([
      "2026-09",
      "2026-08",
      "2020-01",
    ]);
  });

  it("marks the default complete month", () => {
    expect(
      anchorHint({
        anchor: "2026-09",
        defaultAnchor: { month: "2026-09", complete: true },
        coverage: full("2026-09"),
        metricNames: NAMES,
      }),
    ).toEqual({ kind: "latest_complete", text: "Senaste kompletta månad" });
  });

  it("says incomplete and what is missing", () => {
    const hint = anchorHint({
      anchor: "2026-09",
      defaultAnchor: { month: "2026-09", complete: false },
      coverage: {
        resultat: ["2026-08"],
        aktiva_deltagare: ["2026-08", "2026-09"],
        timmar: ["2026-07", "2026-08"],
      },
      metricNames: NAMES,
    });
    expect(hint).toEqual({
      kind: "incomplete",
      text: "Ofullständig",
      detail: "Saknar data för september 2026: Resultat, Fakturerade timmar.",
    });
  });

  it("ignores key metrics the company never reports", () => {
    // MB Restart has no Intelliplan hours: its months are complete without them.
    const coverage = { resultat: ["2026-09"], aktiva_deltagare: ["2026-09"], timmar: [] };
    expect(
      anchorHint({
        anchor: "2026-09",
        defaultAnchor: { month: "2026-09", complete: true },
        coverage,
        metricNames: NAMES,
      }),
    ).toEqual({ kind: "latest_complete", text: "Senaste kompletta månad" });
    expect(hintCoverageRange("2026-09", "2026-09")).toEqual({ from: "2024-10", to: "2026-09" });
    // An older month also looks at what the company reported since.
    expect(hintCoverageRange("2025-03", "2026-09")).toEqual({ from: "2023-04", to: "2026-09" });
  });

  it("shows nothing for another complete month", () => {
    expect(
      anchorHint({
        anchor: "2026-05",
        defaultAnchor: { month: "2026-09", complete: true },
        coverage: full("2026-05"),
        metricNames: NAMES,
      }),
    ).toBeNull();
    expect(effectiveAnchor({ company: "ALL", grain: "month", anchor: null }, "2026-09")).toBe(
      "2026-09",
    );
    expect(effectiveAnchor({ company: "ALL", grain: "month", anchor: "2026-02" }, "2026-09")).toBe(
      "2026-02",
    );
  });
});
