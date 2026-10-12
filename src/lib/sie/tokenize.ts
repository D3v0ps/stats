// Line tokenizer for SIE 4 (spec "SIE filformat ver 4B"). Every line is a
// label ("#TRANS") followed by fields separated by spaces or tabs. A field is a
// bare word, a quoted string (where \" is a literal quote) or an object list
// in braces ({1 "100" 6 "P1"}, possibly empty). Lines holding only "{" or "}"
// open and close the transaction block that follows a #VER.

export type SieField =
  { kind: "text"; value: string; quoted: boolean } | { kind: "list"; items: string[] };

export type SieLine =
  | { kind: "record"; lineNo: number; label: string; fields: SieField[] }
  | { kind: "blockStart"; lineNo: number }
  | { kind: "blockEnd"; lineNo: number }
  /** A non-empty line that does not start with "#", "{" or "}". */
  | { kind: "other"; lineNo: number; text: string };

export interface TokenizeIssue {
  lineNo: number;
  message: string;
}

export interface TokenizeResult {
  lines: SieLine[];
  issues: TokenizeIssue[];
}

const isSpace = (c: string | undefined) => c === " " || c === "\t";

/** Reads a quoted string starting at s[start] === '"'. */
function readQuoted(s: string, start: number): { value: string; end: number; closed: boolean } {
  let value = "";
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === '"') {
      value += '"';
      i += 2;
    } else if (c === '"') {
      return { value, end: i + 1, closed: true };
    } else {
      value += c;
      i++;
    }
  }
  return { value, end: i, closed: false };
}

function readBare(s: string, start: number, stops: string): { value: string; end: number } {
  let i = start;
  while (i < s.length && !isSpace(s[i]) && !stops.includes(s[i] as string)) i++;
  return { value: s.slice(start, i), end: i };
}

/**
 * Tokenizes one line (without its line break). Returns the produced lines (a
 * record may be followed by an implicit block start, see below) and issues.
 */
export function tokenizeLine(raw: string, lineNo: number): TokenizeResult {
  const issues: TokenizeIssue[] = [];
  // A leading BOM, surrounding blanks and the DOS end-of-file mark (Ctrl-Z) are not content.
  const s = raw.replace(/^[ \t﻿]+|[ \t\u001a]+$/g, "");
  if (s === "") return { lines: [], issues };
  if (s === "{") return { lines: [{ kind: "blockStart", lineNo }], issues };
  if (s === "}") return { lines: [{ kind: "blockEnd", lineNo }], issues };
  if (!s.startsWith("#")) return { lines: [{ kind: "other", lineNo, text: s }], issues };

  const labelEnd = readBare(s, 0, '{"');
  const label = labelEnd.value.toUpperCase();
  const fields: SieField[] = [];
  let trailingBlockStart = false;
  let i = labelEnd.end;

  while (i < s.length) {
    while (isSpace(s[i])) i++;
    if (i >= s.length) break;
    const c = s[i];
    if (c === '"') {
      const q = readQuoted(s, i);
      if (!q.closed) issues.push({ lineNo, message: "Citattecken saknar avslutning" });
      fields.push({ kind: "text", value: q.value, quoted: true });
      i = q.end;
    } else if (c === "{") {
      const close = findListEnd(s, i + 1);
      if (close === -1 && label === "#VER" && s.slice(i + 1).trim() === "") {
        // "#VER A 1 20260105 "Text" {" – some writers open the block on the #VER line.
        trailingBlockStart = true;
        break;
      }
      const items: string[] = [];
      let j = i + 1;
      const end = close === -1 ? s.length : close;
      while (j < end) {
        while (j < end && isSpace(s[j])) j++;
        if (j >= end) break;
        if (s[j] === '"') {
          const q = readQuoted(s.slice(0, end), j);
          if (!q.closed) issues.push({ lineNo, message: "Citattecken saknar avslutning" });
          items.push(q.value);
          j = q.end;
        } else {
          const b = readBare(s.slice(0, end), j, '"');
          items.push(b.value);
          j = b.end;
        }
      }
      if (close === -1) issues.push({ lineNo, message: "Objektlistan saknar }" });
      fields.push({ kind: "list", items });
      i = close === -1 ? s.length : close + 1;
    } else {
      const b = readBare(s, i, "{");
      fields.push({ kind: "text", value: b.value, quoted: false });
      i = b.end;
    }
  }

  const lines: SieLine[] = [{ kind: "record", lineNo, label, fields }];
  if (trailingBlockStart) lines.push({ kind: "blockStart", lineNo });
  return { lines, issues };
}

/** Index of the "}" closing a list whose content starts at `from`, honoring quotes. */
function findListEnd(s: string, from: number): number {
  let i = from;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      i = readQuoted(s, i).end;
    } else if (c === "}") {
      return i;
    } else {
      i++;
    }
  }
  return -1;
}

export function tokenizeSie(text: string): TokenizeResult {
  const lines: SieLine[] = [];
  const issues: TokenizeIssue[] = [];
  const rawLines = text.split(/\r\n|\r|\n/);
  for (let n = 0; n < rawLines.length; n++) {
    const r = tokenizeLine(rawLines[n] ?? "", n + 1);
    lines.push(...r.lines);
    issues.push(...r.issues);
  }
  return { lines, issues };
}
