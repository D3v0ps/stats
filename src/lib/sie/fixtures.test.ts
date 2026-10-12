import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSieFixtures } from "../../../scripts/fixtures/sie";
import { readSieFixture, SIE_FIXTURE_DIR, SIE_FIXTURES } from "./test-fixtures";

describe("SIE fixtures", () => {
  const generated = generateSieFixtures();

  it("are committed exactly as the generator writes them", () => {
    for (const f of generated) {
      expect(Buffer.from(readSieFixture(f.path)).equals(Buffer.from(f.bytes)), f.path).toBe(true);
    }
  });

  it("cover every fixture with a truth file and nothing else", () => {
    expect(generated.map((f) => f.path).sort()).toEqual(
      [...SIE_FIXTURES, ...SIE_FIXTURES.map((n) => `truth/${n.replace(/\.se$/, ".json")}`)].sort(),
    );
    expect(
      readdirSync(SIE_FIXTURE_DIR)
        .filter((f) => f.endsWith(".se"))
        .sort(),
    ).toEqual([...SIE_FIXTURES].sort());
  });

  it("are deterministic", () => {
    const again = generateSieFixtures();
    expect(again.map((f) => Buffer.from(f.bytes).toString("base64"))).toEqual(
      generated.map((f) => Buffer.from(f.bytes).toString("base64")),
    );
  });

  it("use CP437 for Swedish letters (except the mislabeled file)", () => {
    const cp437 = readSieFixture("mbab_2026_psaldo.se");
    // "Löner" in CP437: ö = 0x94
    expect(Buffer.from(cp437).includes(Buffer.from([0x4c, 0x94, 0x6e, 0x65, 0x72]))).toBe(true);
    const ansi = readSieFixture("mbab_declared_pc8_but_1252.se");
    // "Löner" in Windows-1252: ö = 0xF6
    expect(Buffer.from(ansi).includes(Buffer.from([0x4c, 0xf6, 0x6e, 0x65, 0x72]))).toBe(true);
    expect(Buffer.from(ansi).includes(Buffer.from("#FORMAT PC8"))).toBe(true);
  });
});
