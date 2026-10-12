import { describe, expect, it } from "vitest";
import { chunkBySize, jsonBytes, progressPercent, STAGE_MAX_BYTES } from "./chunking";

describe("chunkBySize", () => {
  it("splits by item count", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(chunkBySize(items, { maxItems: 4, maxBytes: 1e9 })).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
  });

  it("splits by serialized size", () => {
    const items = ["aaaa", "bbbb", "cccc", "dddd"]; // 6 bytes each + 1 separator
    expect(chunkBySize(items, { maxItems: 100, maxBytes: 15 })).toEqual([
      ["aaaa", "bbbb"],
      ["cccc", "dddd"],
    ]);
  });

  it("keeps an oversized item in a chunk of its own", () => {
    expect(chunkBySize(["x".repeat(50), "y"], { maxItems: 10, maxBytes: 10 })).toEqual([
      ["x".repeat(50)],
      ["y"],
    ]);
  });

  it("returns no chunks for no items and rejects bad limits", () => {
    expect(chunkBySize([])).toEqual([]);
    expect(() => chunkBySize([1], { maxItems: 0 })).toThrow();
    expect(() => chunkBySize([1], { maxBytes: 0 })).toThrow();
  });

  it("keeps every chunk of realistic facts under the byte limit", () => {
    const facts = Array.from({ length: 5000 }, (_, i) => ({
      metricKey: "timmar",
      company: "MBAB",
      month: "2026-09",
      dims: { kund: `Kund ${i % 40}`, konsult: String(1000 + i), verksamhet: "Bemanning" },
      value: 8.5,
      sourceRows: Array.from({ length: 30 }, (_, k) => i * 30 + k + 2),
    }));
    const chunks = chunkBySize(facts);
    expect(chunks.flat()).toHaveLength(5000);
    for (const c of chunks) expect(jsonBytes(c)).toBeLessThanOrEqual(STAGE_MAX_BYTES + 2);
  });

  it("counts UTF-8 bytes for Swedish letters", () => {
    expect(jsonBytes("åäö")).toBe(8);
  });
});

describe("progressPercent", () => {
  it("rounds and clamps", () => {
    expect(progressPercent(0, 10)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(10, 10)).toBe(100);
    expect(progressPercent(12, 10)).toBe(100);
    expect(progressPercent(0, 0)).toBe(0);
  });
});
