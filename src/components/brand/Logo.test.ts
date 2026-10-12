import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readPngSize } from "./png-size";

vi.mock("server-only", () => ({}));

const { LOGO_FILES, Logo, findLogoAsset } = await import("./Logo");

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("readPngSize", () => {
  it("reads width and height from the IHDR chunk", () => {
    expect(readPngSize(pngHeader(1200, 300))).toEqual({ width: 1200, height: 300 });
  });

  it("rejects non-PNG and truncated input", () => {
    expect(readPngSize(new Uint8Array(10))).toBeNull();
    const notPng = pngHeader(10, 10);
    notPng[1] = 0x00;
    expect(readPngSize(notPng)).toBeNull();
    const wrongChunk = pngHeader(10, 10);
    wrongChunk[12] = 0x41;
    expect(readPngSize(wrongChunk)).toBeNull();
    expect(readPngSize(pngHeader(0, 10))).toBeNull();
  });
});

describe("findLogoAsset", () => {
  it("finds a deployed logo and its size", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mb-logo-"));
    try {
      mkdirSync(path.join(dir, "brand"));
      writeFileSync(path.join(dir, "brand", LOGO_FILES.white), pngHeader(800, 200));
      expect(findLogoAsset("white", dir)).toEqual({
        src: `/brand/${LOGO_FILES.white}`,
        width: 800,
        height: 200,
      });
      expect(findLogoAsset("dark", dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("<Logo>", () => {
  it("falls back to the typographic logo with a red dot when no file is deployed", () => {
    const html = renderToStaticMarkup(createElement(Logo, { variant: "white" }));
    expect(html).toContain('aria-label="Miljonbemanning"');
    expect(html).toContain('MB<span class="text-rod">.</span>');
    expect(html).toContain("Miljonbemanning</span>");
    expect(html).toContain("text-white");
    expect(html).toContain("font-extrabold");
  });

  it("uses antracit on light backgrounds", () => {
    const html = renderToStaticMarkup(createElement(Logo, { variant: "dark", size: "lg" }));
    expect(html).toContain("text-antracit");
    expect(html).toContain("text-5xl");
  });
});
