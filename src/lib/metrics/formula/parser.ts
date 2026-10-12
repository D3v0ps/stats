// Recursive-descent parser for metric formulas.
//   expr   := term (("+" | "-") term)*
//   term   := unary (("*" | "/") unary)*
//   unary  := ("-" | "+") unary | primary
//   primary:= number | metric_key | "(" expr ")"
// Binary operators are left-associative; unary minus binds tighter than * and /.
import { FormulaSyntaxError } from "../errors";
import { tokenize, type Token } from "./lexer";

export type BinaryOp = "+" | "-" | "*" | "/";

export type FormulaNode =
  | { type: "number"; value: number }
  | { type: "ref"; key: string }
  | { type: "neg"; operand: FormulaNode }
  | { type: "binary"; op: BinaryOp; left: FormulaNode; right: FormulaNode };

/** Nesting limit for parentheses and unary signs, so hostile input cannot exhaust the stack. */
export const MAX_FORMULA_DEPTH = 64;

export function parseFormula(source: string): FormulaNode {
  const tokens = tokenize(source);
  let index = 0;
  let depth = 0;

  const nested = <T>(at: Token, parse: () => T): T => {
    if (++depth > MAX_FORMULA_DEPTH) {
      throw new FormulaSyntaxError(
        `Formeln är för djupt nästlad (högst ${MAX_FORMULA_DEPTH} nivåer).`,
        at.pos,
      );
    }
    const result = parse();
    depth--;
    return result;
  };

  const peek = (): Token => tokens[index] as Token;
  const next = (): Token => tokens[index++] as Token;

  const describe = (t: Token): string =>
    t.type === "end" ? "slutet av formeln" : `"${t.text}" vid position ${t.pos + 1}`;

  function expr(): FormulaNode {
    let left = term();
    for (;;) {
      const t = peek();
      if (t.type !== "op" || (t.text !== "+" && t.text !== "-")) return left;
      next();
      left = { type: "binary", op: t.text, left, right: term() };
    }
  }

  function term(): FormulaNode {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t.type !== "op" || (t.text !== "*" && t.text !== "/")) return left;
      next();
      left = { type: "binary", op: t.text, left, right: unary() };
    }
  }

  function unary(): FormulaNode {
    const t = peek();
    if (t.type === "op" && t.text === "-") {
      next();
      return { type: "neg", operand: nested(t, unary) };
    }
    if (t.type === "op" && t.text === "+") {
      next();
      return nested(t, unary);
    }
    return primary();
  }

  function primary(): FormulaNode {
    const t = next();
    switch (t.type) {
      case "number":
        return { type: "number", value: Number(t.text) };
      case "ident":
        return { type: "ref", key: t.text };
      case "lparen": {
        const inner = nested(t, expr);
        const close = next();
        if (close.type !== "rparen") {
          throw new FormulaSyntaxError(`Saknar ")" – hittade ${describe(close)}.`, close.pos);
        }
        return inner;
      }
      default:
        throw new FormulaSyntaxError(
          `Förväntade ett tal eller mått, hittade ${describe(t)}.`,
          t.pos,
        );
    }
  }

  if (peek().type === "end") throw new FormulaSyntaxError("Formeln är tom.", 0);
  const ast = expr();
  const rest = peek();
  if (rest.type !== "end") {
    throw new FormulaSyntaxError(`Oväntat ${describe(rest)}.`, rest.pos);
  }
  return ast;
}

/** Metric keys referenced by the formula, unique, in order of first appearance. */
export function referencedKeys(node: FormulaNode): string[] {
  const out: string[] = [];
  const walk = (n: FormulaNode): void => {
    switch (n.type) {
      case "number":
        return;
      case "ref":
        if (!out.includes(n.key)) out.push(n.key);
        return;
      case "neg":
        walk(n.operand);
        return;
      case "binary":
        walk(n.left);
        walk(n.right);
        return;
    }
  };
  walk(node);
  return out;
}

/** Canonical text form (fully parenthesized binary operations), for tests and debugging. */
export function formatFormula(node: FormulaNode): string {
  switch (node.type) {
    case "number":
      return String(node.value);
    case "ref":
      return node.key;
    case "neg":
      return `-${formatFormula(node.operand)}`;
    case "binary":
      return `(${formatFormula(node.left)} ${node.op} ${formatFormula(node.right)})`;
  }
}
