import { describe, expect, it } from "vitest";
import { MetricConfigError, PersonalDataError } from "@/lib/metrics";
import { GENERIC_REPORT_ERROR, describeReportError } from "./errors";

class FakeDbError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DbError";
  }
}

describe("describeReportError", () => {
  it("passes our own Swedish messages through", () => {
    expect(describeReportError(new PersonalDataError(["konsult"], "Rapporten"))).toBe(
      "Rapporten får inte grupperas eller filtreras på personuppgifter (konsult).",
    );
    expect(describeReportError(new MetricConfigError("Okänt mått: x.", "x"))).toBe(
      "Okänt mått: x.",
    );
    expect(
      describeReportError(new FakeDbError("Personliga dimensioner får inte förekomma", "23514")),
    ).toBe("Personliga dimensioner får inte förekomma");
  });

  it("hides technical errors behind a calm message", () => {
    expect(describeReportError(new Error("fetch failed"))).toBe(GENERIC_REPORT_ERROR);
    expect(describeReportError(new FakeDbError("permission denied", "42501"))).toBe(
      GENERIC_REPORT_ERROR,
    );
    expect(describeReportError("boom", "Kunde inte spara.")).toBe("Kunde inte spara.");
  });
});
