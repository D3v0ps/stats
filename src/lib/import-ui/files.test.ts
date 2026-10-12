import { describe, expect, it } from "vitest";
import {
  EMPTY_FILE_MESSAGE,
  FILE_INPUT_ACCEPT,
  MAX_FILE_BYTES,
  PDF_MESSAGE,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  classifyFileName,
  fileProblem,
} from "./files";

describe("classifyFileName", () => {
  it.each([
    ["timmar.xlsx", "spreadsheet"],
    ["TIMMAR.XLSX", "spreadsheet"],
    ["kundlista.xls", "spreadsheet"],
    ["franvaro.csv", "spreadsheet"],
    ["export.txt", "spreadsheet"],
    ["bokforing.se", "spreadsheet"],
    ["bokforing.SI", "spreadsheet"],
    ["bokforing.sie", "spreadsheet"],
    ["rapport.pdf", "pdf"],
    ["bild.png", "unsupported"],
    ["utan-filandelse", "unsupported"],
    [".xlsx", "unsupported"],
    ["mapp/undermapp/fil.csv", "spreadsheet"],
  ])("%s -> %s", (name, expected) => {
    expect(classifyFileName(name)).toBe(expected);
  });
});

describe("fileProblem", () => {
  it("accepts readable files", () => {
    expect(fileProblem({ name: "a.xlsx", size: 10 })).toBeNull();
  });

  it("explains PDF, unsupported, empty and too large files", () => {
    expect(fileProblem({ name: "a.pdf", size: 10 })).toBe(PDF_MESSAGE);
    expect(fileProblem({ name: "a.docx", size: 10 })).toBe(UNSUPPORTED_MESSAGE);
    expect(fileProblem({ name: "a.csv", size: 0 })).toBe(EMPTY_FILE_MESSAGE);
    expect(fileProblem({ name: "a.csv", size: MAX_FILE_BYTES + 1 })).toBe(TOO_LARGE_MESSAGE);
  });

  it("lists every extension in the picker filter", () => {
    for (const ext of [".csv", ".xlsx", ".xls", ".se", ".si", ".txt", ".pdf"]) {
      expect(FILE_INPUT_ACCEPT.split(",")).toContain(ext);
    }
  });
});
