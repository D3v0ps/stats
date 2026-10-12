// readWorkbook: bytes in, RawWorkbook out. The format is sniffed from the
// content, never from the extension.
import type { FileFormat, RawWorkbook } from "@/lib/contracts";
import { decodeText } from "@/lib/core/encoding";
import { parseCsv } from "./csv";
import { readBinaryWorkbook, readHtmlWorkbook, readXmlWorkbook } from "./sheetjs";
import { sniffReader, type ReaderKind } from "./sniff";

export { CSV_DELIMITERS, parseCsv, sniffDelimiter, type CsvDelimiter } from "./csv";
export { sniffReader, type ReaderKind } from "./sniff";

/** The file could not be read at all (corrupt, encrypted, not a spreadsheet). */
export class ReadError extends Error {
  override name = "ReadError";
}

const FORMAT_BY_READER: Record<ReaderKind, FileFormat> = {
  zip: "xlsx",
  cfb: "xls",
  html: "html",
  xml: "xls",
  sie: "sie",
  pdf: "pdf",
  text: "csv",
};

export function sniffFormat(bytes: Uint8Array): FileFormat {
  return FORMAT_BY_READER[sniffReader(bytes)];
}

function baseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name) || "Blad1";
}

function describe(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/password|encrypt/i.test(msg)) return "Filen är lösenordsskyddad.";
  return "Filen kunde inte läsas som kalkylblad.";
}

/**
 * Read a spreadsheet-like file. SIE and PDF return no sheets (SIE is parsed by
 * the SIE module; PDF is phase 2). Throws ReadError for unreadable files;
 * individual bad cells never throw (they become error cells).
 */
export function readWorkbook(bytes: Uint8Array, fileName: string): RawWorkbook {
  const reader = sniffReader(bytes);
  const format = FORMAT_BY_READER[reader];
  const base = { fileName, format, date1904: false } as const;

  switch (reader) {
    case "sie":
    case "pdf":
      return { ...base, sheets: [] };
    case "text": {
      const { text, encoding } = decodeText(bytes);
      const { rows, delimiter } = parseCsv(text);
      return {
        ...base,
        encoding,
        delimiter,
        sheets: [{ name: baseName(fileName), hidden: false, rows, merges: [] }],
      };
    }
    case "html":
    case "xml": {
      const { text, encoding } = decodeText(bytes);
      try {
        const result = reader === "html" ? readHtmlWorkbook(text) : readXmlWorkbook(text);
        return { ...base, encoding, date1904: result.date1904, sheets: result.sheets };
      } catch (error) {
        throw new ReadError(describe(error), { cause: error });
      }
    }
    case "zip":
    case "cfb": {
      try {
        const result = readBinaryWorkbook(bytes);
        return { ...base, date1904: result.date1904, sheets: result.sheets };
      } catch (error) {
        throw new ReadError(describe(error), { cause: error });
      }
    }
  }
}
