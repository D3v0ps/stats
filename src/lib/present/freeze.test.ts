import { describe, expect, it } from "vitest";
import {
  FreezeInputSchema,
  defaultFreezeTitle,
  freezeInputError,
  isoWeek,
  isoWeekOfDate,
  monthOptions,
  monthOptionsWith,
} from "./freeze";

describe("isoWeekOfDate", () => {
  it("follows ISO 8601 weeks", () => {
    expect(isoWeekOfDate(2026, 10, 12)).toEqual({ year: 2026, week: 42 });
    expect(isoWeekOfDate(2026, 1, 1)).toEqual({ year: 2026, week: 1 });
    // 2025-12-29 is the Monday of 2026's first week.
    expect(isoWeekOfDate(2025, 12, 29)).toEqual({ year: 2026, week: 1 });
    // 2026 has 53 weeks; 2027-01-01 (a Friday) still belongs to it.
    expect(isoWeekOfDate(2026, 12, 31)).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOfDate(2027, 1, 1)).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOfDate(2027, 1, 4)).toEqual({ year: 2027, week: 1 });
    expect(isoWeekOfDate(2024, 12, 30)).toEqual({ year: 2025, week: 1 });
  });
});

describe("isoWeek", () => {
  it("uses the Stockholm calendar date", () => {
    // Sunday 22:30 UTC is already Monday in Stockholm (CEST).
    expect(isoWeek(new Date("2026-10-11T22:30:00Z"))).toEqual({ year: 2026, week: 42 });
    expect(isoWeek(new Date("2026-10-11T21:30:00Z"))).toEqual({ year: 2026, week: 41 });
  });
});

describe("defaultFreezeTitle", () => {
  it("names the meeting after the week", () => {
    expect(defaultFreezeTitle(new Date("2026-10-12T08:00:00Z"))).toBe("Styrelsemöte v.42");
    expect(defaultFreezeTitle(new Date("2026-01-05T08:00:00Z"))).toBe("Styrelsemöte v.2");
  });
});

describe("monthOptions", () => {
  it("lists months newest first with Swedish labels", () => {
    expect(monthOptions("2026-09", 3)).toEqual([
      { value: "2026-09", label: "September 2026" },
      { value: "2026-08", label: "Augusti 2026" },
      { value: "2026-07", label: "Juli 2026" },
    ]);
    expect(monthOptions("2026-01", 2).map((o) => o.value)).toEqual(["2026-01", "2025-12"]);
    expect(monthOptions("2026-01", 0)).toEqual([]);
  });

  it("adds a selected month outside the window in order", () => {
    const options = monthOptionsWith("2026-09", "2024-01", 2);
    expect(options.map((o) => o.value)).toEqual(["2026-09", "2026-08", "2024-01"]);
    expect(monthOptionsWith("2026-09", "2026-08", 2)).toHaveLength(2);
  });
});

describe("FreezeInputSchema", () => {
  const valid = {
    templateId: "0d7c3c2e-8f43-4b1a-9a52-3f8a1c2b4d5e",
    title: "  Styrelsemöte v.42 ",
    month: "2026-09",
  };

  it("trims the title and accepts a template id and a month", () => {
    expect(FreezeInputSchema.parse(valid)).toEqual({ ...valid, title: "Styrelsemöte v.42" });
    expect(freezeInputError(valid)).toBeNull();
  });

  it("explains what is wrong in Swedish", () => {
    expect(freezeInputError({ ...valid, title: "   " })).toBe("Rapporten behöver en titel");
    expect(freezeInputError({ ...valid, title: "x".repeat(121) })).toBe(
      "Titeln får vara högst 120 tecken",
    );
    expect(freezeInputError({ ...valid, month: "2026-13" })).toBe("Välj en månad");
    expect(freezeInputError({ ...valid, templateId: "nope" })).toBe("Okänd rapportmall");
  });
});
