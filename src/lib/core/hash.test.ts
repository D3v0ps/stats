import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("hashes strings (known vectors)", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes bytes the same as the equivalent string", async () => {
    const bytes = new TextEncoder().encode("Malmö");
    expect(await sha256Hex(bytes)).toBe(await sha256Hex("Malmö"));
  });

  it("hashes a subarray view by its visible bytes only", async () => {
    const buf = new TextEncoder().encode("xxabcxx");
    expect(await sha256Hex(buf.subarray(2, 5))).toBe(await sha256Hex("abc"));
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("is independent of insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("drops undefined properties and maps non-finite numbers to null", () => {
    expect(canonicalJson({ a: undefined, b: Number.NaN, c: null })).toBe('{"b":null,"c":null}');
    expect(canonicalJson(undefined)).toBe("null");
  });
});
