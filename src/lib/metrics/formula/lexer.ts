// Tokenizer for the metric formula language: metric keys, numeric literals with a
// '.' decimal point, + - * / and parentheses. Whitespace is insignificant.
import { FormulaSyntaxError } from "../errors";

export type TokenType = "number" | "ident" | "op" | "lparen" | "rparen" | "end";

export interface Token {
  type: TokenType;
  /** Source text of the token ("" for end). */
  text: string;
  /** 0-based offset in the formula. */
  pos: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", text: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", text: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", text: ch, pos: i });
      i++;
      continue;
    }
    if (DIGIT.test(ch) || ch === ".") {
      const start = i;
      while (i < source.length && DIGIT.test(source[i] as string)) i++;
      if (source[i] === ".") {
        i++;
        const fracStart = i;
        while (i < source.length && DIGIT.test(source[i] as string)) i++;
        if (i === fracStart) {
          throw new FormulaSyntaxError(`Ofullständigt tal vid position ${start + 1}.`, start);
        }
      }
      if (i < source.length && (IDENT_PART.test(source[i] as string) || source[i] === ".")) {
        throw new FormulaSyntaxError(`Ogiltigt tal vid position ${start + 1}.`, start);
      }
      tokens.push({ type: "number", text: source.slice(start, i), pos: start });
      continue;
    }
    if (IDENT_START.test(ch)) {
      const start = i;
      while (i < source.length && IDENT_PART.test(source[i] as string)) i++;
      tokens.push({ type: "ident", text: source.slice(start, i), pos: start });
      continue;
    }
    throw new FormulaSyntaxError(`Ogiltigt tecken "${ch}" vid position ${i + 1}.`, i);
  }
  tokens.push({ type: "end", text: "", pos: source.length });
  return tokens;
}
