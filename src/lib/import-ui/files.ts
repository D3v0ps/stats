// Which dropped files the upload page accepts. The extension only decides what
// we try; the readers sniff the real format from the content afterwards.

export const ACCEPTED_EXTENSIONS = [
  ".csv",
  ".xlsx",
  ".xls",
  ".se",
  ".si",
  ".sie",
  ".txt",
  ".pdf",
] as const;

/** `accept` attribute for the file picker (extensions plus the common MIME types). */
export const FILE_INPUT_ACCEPT = [
  ...ACCEPTED_EXTENSIONS,
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
].join(",");

/** Larger files are refused before reading: 50k-row exports are a few MB. */
export const MAX_FILE_BYTES = 60 * 1024 * 1024;

export type FileClass = "spreadsheet" | "pdf" | "unsupported";

export const PDF_MESSAGE = "PDF stöds i fas 2. Exportera rapporten som Excel eller CSV i stället.";
export const UNSUPPORTED_MESSAGE =
  "Filtypen stöds inte. Använd Excel (.xlsx, .xls), CSV, text eller SIE (.se).";
export const TOO_LARGE_MESSAGE = "Filen är för stor (högst 60 MB).";
export const EMPTY_FILE_MESSAGE = "Filen är tom.";

function extension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** What to do with a dropped file, judged by its name only. */
export function classifyFileName(name: string): FileClass {
  const ext = extension(name);
  if (ext === ".pdf") return "pdf";
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ? "spreadsheet" : "unsupported";
}

/** null when the file can be read, otherwise the message shown on its card. */
export function fileProblem(file: { name: string; size: number }): string | null {
  switch (classifyFileName(file.name)) {
    case "pdf":
      return PDF_MESSAGE;
    case "unsupported":
      return UNSUPPORTED_MESSAGE;
    case "spreadsheet":
      if (file.size === 0) return EMPTY_FILE_MESSAGE;
      if (file.size > MAX_FILE_BYTES) return TOO_LARGE_MESSAGE;
      return null;
  }
}
