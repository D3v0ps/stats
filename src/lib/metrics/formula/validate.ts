// Static checks for formula metrics: syntax, references to unknown metric keys and
// reference cycles between formula metrics. Run when formulas are saved in settings;
// the engine also refuses to evaluate a cycle at query time.
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { FormulaSyntaxError } from "../errors";
import { parseFormula, referencedKeys, type FormulaNode } from "./parser";

export type FormulaIssueCode = "missing_formula" | "syntax" | "unknown_key" | "cycle";

export interface FormulaIssue {
  metricKey: string;
  code: FormulaIssueCode;
  message: string;
  /** unknown_key: the unknown keys; cycle: the cycle path starting and ending at metricKey. */
  keys: string[];
  /** syntax: 0-based offset of the error. */
  position?: number;
}

/** All issues across the definitions; [] means every formula metric can be evaluated. */
export function validateFormulas(definitions: readonly MetricDefinition[]): FormulaIssue[] {
  const issues: FormulaIssue[] = [];
  const known = new Set(definitions.map((d) => d.key));
  const formulaRefs = new Map<string, string[]>();

  for (const def of definitions) {
    if (def.kind !== "formula") continue;
    const source = def.formula?.trim() ?? "";
    if (source === "") {
      issues.push({
        metricKey: def.key,
        code: "missing_formula",
        message: `Måttet ${def.key} saknar formel.`,
        keys: [],
      });
      continue;
    }
    let ast: FormulaNode;
    try {
      ast = parseFormula(source);
    } catch (e) {
      if (!(e instanceof FormulaSyntaxError)) throw e;
      issues.push({
        metricKey: def.key,
        code: "syntax",
        message: e.message,
        keys: [],
        position: e.position,
      });
      continue;
    }
    const refs = referencedKeys(ast);
    const unknown = refs.filter((k) => !known.has(k));
    if (unknown.length > 0) {
      issues.push({
        metricKey: def.key,
        code: "unknown_key",
        message: `Okänt mått i formeln: ${unknown.join(", ")}.`,
        keys: unknown,
      });
    }
    formulaRefs.set(
      def.key,
      refs.filter((k) => known.has(k)),
    );
  }

  for (const [key, cycle] of findCycles(formulaRefs)) {
    issues.push({
      metricKey: key,
      code: "cycle",
      message: `Formeln refererar till sig själv: ${cycle.join(" → ")}.`,
      keys: cycle,
    });
  }
  return issues;
}

/**
 * Every formula metric that lies on a reference cycle, with one shortest cycle through
 * it (path starting and ending at that metric). A metric is on a cycle when its
 * strongly connected component has more than one member or it references itself.
 */
function findCycles(refs: Map<string, string[]>): Map<string, string[]> {
  const edges = (key: string): string[] => (refs.get(key) ?? []).filter((r) => refs.has(r));
  const out = new Map<string, string[]>();
  for (const component of stronglyConnected([...refs.keys()], edges)) {
    const members = new Set(component);
    for (const key of component) {
      const cyclic = members.size > 1 || edges(key).includes(key);
      if (!cyclic) continue;
      out.set(
        key,
        shortestCycle(key, (k) => edges(k).filter((r) => members.has(r))),
      );
    }
  }
  return out;
}

/** Tarjan's algorithm. Formula graphs are tiny, so recursion depth is not a concern. */
function stronglyConnected(nodes: string[], edges: (key: string) => string[]): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const connect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges(v)) {
      if (!index.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  };

  for (const v of nodes) if (!index.has(v)) connect(v);
  return components;
}

/** Breadth-first search from `start` back to itself. */
function shortestCycle(start: string, edges: (key: string) => string[]): string[] {
  const previous = new Map<string, string>();
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of edges(current)) {
      if (next === start) {
        const path = [current];
        while (path[0] !== start) path.unshift(previous.get(path[0] as string) as string);
        return [...path, start];
      }
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  return [start, start];
}
