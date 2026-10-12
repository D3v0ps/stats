import { describe, expect, it } from "vitest";
import { normalizeHeader, normalizeValue } from "./normalize";

describe("normalizeHeader", () => {
  it.each([
    ["  Anställnings-ID: ", "anställnings-id"],
    ["Belopp *", "belopp"],
    ["Belopp:*", "belopp"],
    ["KUND", "kund"],
    ["Antal  pass", "antal pass"],
    ["Antal pass", "antal pass"],
    ["Antal\tpass\n", "antal pass"],
    ["ÅR", "år"],
    ["Ort​", "ort"],
    ["Tid (h:mm)", "tid (h:mm)"],
    ["Kl: 08:00", "kl: 08:00"],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });

  it("applies NFC so decomposed å equals precomposed å", () => {
    expect(normalizeHeader("Årsta")).toBe(normalizeHeader("Årsta"));
  });
});

describe("normalizeValue", () => {
  it.each([
    ["  KROM ", "krom"],
    ["Stöd och  matchning", "stöd och matchning"],
    ["Bemanning:", "bemanning:"],
    ["ÖREBRO", "örebro"],
    ["MBAB:100", "mbab:100"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeValue(input)).toBe(expected);
  });
});
