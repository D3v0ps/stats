// File type detection by content. Extensions lie: many ".xls" exports from
// web systems are HTML tables, and ".txt" can be SIE or CSV.
import { decodeText } from "@/lib/core/encoding";

/** How the bytes must be read; "xml" is Excel 2003 SpreadsheetML. */
export type ReaderKind = "zip" | "cfb" | "html" | "xml" | "sie" | "pdf" | "text";

const HEAD_BYTES = 4096;
const HTML_WINDOW = 2048;

/** Markup at the very start; a CSV whose first cell happens to start with "<" stays text. */
const HTML_START =
  /^<(?:!doctype\b|!--|\?xml\b|(?:html|head|body|table|thead|tbody|tr|td|th|meta|title|style|script|link|div|span|p|br|font|center|h[1-6]|b|i|u|strong|form|pre|xml)\b)/i;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

export function sniffReader(bytes: Uint8Array): ReaderKind {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return "zip";
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "cfb";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";

  const head = decodeText(bytes.subarray(0, HEAD_BYTES)).text.trimStart();
  if (/^#(?:FLAGGA|SIE|PROGRAM\b|FORMAT\b)/i.test(head)) return "sie";
  if (/^<\?xml/i.test(head) && /urn:schemas-microsoft-com:office:spreadsheet/i.test(head)) {
    return "xml";
  }
  if (HTML_START.test(head) || /<table[\s>]/i.test(head.slice(0, HTML_WINDOW))) return "html";
  return "text";
}
