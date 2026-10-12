// Normalization of header texts and dimension values. The normalized form is the
// key used for template signatures, alias lookups and dimension_values.code, so
// it must be identical in the browser, in Node and in SQL-side expectations:
// NFC, Swedish lowercase, trimmed, all whitespace (incl. NBSP/thin spaces) collapsed.

// \s covers NBSP (U+00A0), U+2000–U+200A, narrow NBSP (U+202F), U+3000 and BOM.
const WHITESPACE = /\s+/g;
// Zero-width characters that sneak in via copy/paste from web pages and PDFs.
const ZERO_WIDTH = /[​-‍⁠]/g;

function base(input: string): string {
  return input
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(WHITESPACE, " ")
    .trim()
    .toLocaleLowerCase("sv");
}

/**
 * Normalize a column header: "  Anställnings-ID: " -> "anställnings-id",
 * "Belopp *" -> "belopp". Trailing ":" and "*" (form-style markers) are stripped.
 */
export function normalizeHeader(input: string): string {
  return base(input)
    .replace(/[\s:*]+$/u, "")
    .trim();
}

/** Normalize a cell value used as an alias/dimension key: "  KROM " -> "krom". */
export function normalizeValue(input: string): string {
  return base(input);
}
