// Formula evaluation with null propagation: a missing operand makes the whole
// result null (unknown, not zero), and so does division by zero.
import type { FormulaNode } from "./parser";

export type OperandResolver = (key: string) => number | null;

export function evaluateFormula(node: FormulaNode, resolve: OperandResolver): number | null {
  const value = evaluateNode(node, resolve);
  return value === null || !Number.isFinite(value) ? null : value;
}

function evaluateNode(node: FormulaNode, resolve: OperandResolver): number | null {
  switch (node.type) {
    case "number":
      return node.value;
    case "ref": {
      const v = resolve(node.key);
      return v === null || !Number.isFinite(v) ? null : v;
    }
    case "neg": {
      const v = evaluateNode(node.operand, resolve);
      return v === null ? null : -v;
    }
    case "binary": {
      const left = evaluateNode(node.left, resolve);
      const right = evaluateNode(node.right, resolve);
      if (left === null || right === null) return null;
      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right === 0 ? null : left / right;
      }
    }
  }
}
