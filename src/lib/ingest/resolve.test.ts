import { describe, expect, it } from "vitest";
import type { FactDraft } from "@/lib/contracts";
import { resolveDims, type DimensionDictionary } from "./resolve";

const fact = (dims: Record<string, string>, value = 1): FactDraft => ({
  metricKey: "timmar",
  company: "MBAB",
  month: "2026-09",
  dims,
  value,
  sourceRows: [2],
});

const dict: Record<string, DimensionDictionary> = {
  kund: { byNorm: { "acme ab": 11, "beta ab": 12 }, policy: "ask" },
  verksamhet: { byNorm: { krom: 1, rom2: 2, "stöd och matchning": 5 }, policy: "ask" },
  konsult: { byNorm: { "1001": 101 }, policy: "auto_create" },
};

describe("resolveDims", () => {
  it("resolves labels by normalizeValue", () => {
    const r = resolveDims(
      [fact({ kund: " ACME AB ", verksamhet: "Stöd och  matchning" }, 8)],
      dict,
    );
    expect(r.rows).toEqual([
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-09",
        dims: { kund: 11, verksamhet: 5 },
        value: 8,
        sourceRows: [2],
      },
    ]);
    expect(r.unknown).toEqual({});
  });

  it("returns rows null and lists unknown labels once, split by policy", () => {
    const r = resolveDims(
      [
        fact({ kund: "Acme AB", konsult: "1001" }),
        fact({ kund: "Gamma AB", konsult: "1002" }),
        fact({ kund: "gamma ab", konsult: "1003" }),
        fact({ ort: "Malmö" }),
      ],
      dict,
    );
    expect(r.rows).toBeNull();
    expect(r.unknown).toEqual({ kund: ["Gamma AB"], konsult: ["1002", "1003"], ort: ["Malmö"] });
    expect(r.toCreate).toEqual({ konsult: ["1002", "1003"] });
    expect(r.toAsk).toEqual({ kund: ["Gamma AB"], ort: ["Malmö"] });
  });

  it("handles facts without dimensions and an empty fact list", () => {
    expect(resolveDims([fact({})], {}).rows).toEqual([{ ...fact({}), dims: {} }]);
    expect(resolveDims([], dict)).toEqual({ rows: [], unknown: {}, toCreate: {}, toAsk: {} });
  });

  it("is safe against prototype keys", () => {
    const r = resolveDims([fact({ kund: "constructor" }), fact({ toString: "x" })], dict);
    expect(r.rows).toBeNull();
    expect(r.unknown).toEqual({ kund: ["constructor"], toString: ["x"] });
  });
});
