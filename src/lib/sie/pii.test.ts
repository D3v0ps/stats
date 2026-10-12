import { describe, expect, it } from "vitest";
import { containsPersonnummer, isPersonalDimension, maskPersonnummer, PNR_MASK } from "./pii";

describe("containsPersonnummer", () => {
  it("finds personnummer and samordningsnummer in every common form", () => {
    for (const v of [
      "850101-1234",
      "8501011234",
      "19850101-1234",
      "198501011234",
      "850101+1234",
      "850161-1234", // samordningsnummer (day + 60)
      "000229-1234", // 29 Feb without century may be 2000
      "Lön Anna 850101-1234 jan",
    ]) {
      expect(containsPersonnummer(v), v).toBe(true);
    }
  });

  it("leaves organisation numbers, dates, periods and amounts alone", () => {
    for (const v of [
      "556959-9318",
      "5569599318",
      "165569599318",
      "559208-9071",
      "20260131",
      "202601",
      "#PSALDO 0 202601 3041 {} -123456.78",
      "#RAR 0 20260101 20261231",
      "851301-1234", // month 13
      "850230-1234", // 30 February
      "850100-1234", // day 0
      "19010229-1234", // 1901 is not a leap year
      "12345678901234", // longer number
    ]) {
      expect(containsPersonnummer(v), v).toBe(false);
    }
  });
});

describe("maskPersonnummer", () => {
  it("masks every personnummer and keeps the rest of the text", () => {
    expect(maskPersonnummer("Lön 850101-1234 och 196001011234, org 556959-9318")).toBe(
      `Lön ${PNR_MASK} och ${PNR_MASK}, org 556959-9318`,
    );
    expect(maskPersonnummer("8501011234")).toBe(PNR_MASK);
    expect(maskPersonnummer("inget här")).toBe("inget här");
    expect(maskPersonnummer("")).toBe("");
  });
});

describe("isPersonalDimension", () => {
  it("treats SIE dimension 7 and person-named dimensions as personal", () => {
    expect(isPersonalDimension(7, undefined)).toBe(true);
    expect(isPersonalDimension(7, "Projekt")).toBe(true);
    expect(isPersonalDimension(20, "Anställd")).toBe(true);
    expect(isPersonalDimension(21, "Konsulter")).toBe(true);
    expect(isPersonalDimension(22, "Medarbetare")).toBe(true);
    expect(isPersonalDimension(1, "Kostnadsställe")).toBe(false);
    expect(isPersonalDimension(6, "Projekt")).toBe(false);
    expect(isPersonalDimension(20, undefined)).toBe(false);
  });
});
