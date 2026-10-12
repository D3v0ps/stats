import { describe, expect, it } from "vitest";
import { CATALOG_METRICS } from "@/lib/contracts/catalog";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { catalogDefinitions } from "../catalog";
import { FormulaSyntaxError } from "../errors";
import {
  evaluateFormula,
  formatFormula,
  parseFormula,
  referencedKeys,
  tokenize,
  validateFormulas,
} from "./index";

const env =
  (values: Record<string, number | null>) =>
  (key: string): number | null =>
    key in values ? (values[key] as number | null) : null;

const evalText = (src: string, values: Record<string, number | null> = {}) =>
  evaluateFormula(parseFormula(src), env(values));

function syntaxError(src: string): FormulaSyntaxError {
  try {
    parseFormula(src);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return e;
    throw e;
  }
  throw new Error(`expected a syntax error for ${src}`);
}

describe("tokenize", () => {
  it("splits identifiers, numbers, operators and parentheses with positions", () => {
    expect(tokenize("a_1 + 2.50*(b)")).toEqual([
      { type: "ident", text: "a_1", pos: 0 },
      { type: "op", text: "+", pos: 4 },
      { type: "number", text: "2.50", pos: 6 },
      { type: "op", text: "*", pos: 10 },
      { type: "lparen", text: "(", pos: 11 },
      { type: "ident", text: "b", pos: 12 },
      { type: "rparen", text: ")", pos: 13 },
      { type: "end", text: "", pos: 14 },
    ]);
  });

  it("accepts leading-dot decimals and rejects malformed numbers", () => {
    expect(tokenize(".5")[0]).toEqual({ type: "number", text: ".5", pos: 0 });
    expect(() => tokenize("1.")).toThrow(FormulaSyntaxError);
    expect(() => tokenize("1.2.3")).toThrow(FormulaSyntaxError);
    expect(() => tokenize("12abc")).toThrow(FormulaSyntaxError);
  });

  it("rejects characters outside the language, with their position", () => {
    const e = syntaxError("timmar % 2");
    expect(e.position).toBe(7);
    expect(e.message).toContain('"%"');
    expect(() => tokenize("1,5")).toThrow(FormulaSyntaxError);
  });
});

describe("parseFormula", () => {
  it("binds * and / tighter than + and -", () => {
    expect(formatFormula(parseFormula("a + b * c"))).toBe("(a + (b * c))");
    expect(formatFormula(parseFormula("a / b - c"))).toBe("((a / b) - c)");
  });

  it("is left-associative", () => {
    expect(formatFormula(parseFormula("a - b - c"))).toBe("((a - b) - c)");
    expect(formatFormula(parseFormula("a / b / c"))).toBe("((a / b) / c)");
    expect(evalText("8 / 4 / 2")).toBe(1);
    expect(evalText("10 - 4 - 3")).toBe(3);
  });

  it("honours parentheses", () => {
    expect(formatFormula(parseFormula("(a + b) * c"))).toBe("((a + b) * c)");
    expect(evalText("(2 + 3) * 4")).toBe(20);
    expect(evalText("2 + 3 * 4")).toBe(14);
    expect(evalText("((1))")).toBe(1);
  });

  it("supports unary minus (and plus), binding tighter than multiplication", () => {
    expect(formatFormula(parseFormula("-a * b"))).toBe("(-a * b)");
    expect(evalText("-2 * 3")).toBe(-6);
    expect(evalText("--2")).toBe(2);
    expect(evalText("4 - -2")).toBe(6);
    expect(evalText("-(1 + 2)")).toBe(-3);
    expect(evalText("+5")).toBe(5);
  });

  it("parses decimal literals", () => {
    expect(evalText("1.5 * 2")).toBe(3);
    expect(evalText("0.25 + .75")).toBe(1);
    expect(parseFormula("fakturerat_ip / (lonekostnad * 1.0)")).toEqual({
      type: "binary",
      op: "/",
      left: { type: "ref", key: "fakturerat_ip" },
      right: {
        type: "binary",
        op: "*",
        left: { type: "ref", key: "lonekostnad" },
        right: { type: "number", value: 1 },
      },
    });
  });

  it("parses every seeded catalog formula", () => {
    for (const m of CATALOG_METRICS.filter((x) => x.kind === "formula")) {
      expect(() => parseFormula(m.formula ?? "")).not.toThrow();
    }
  });

  it("reports syntax errors with positions", () => {
    expect(syntaxError("").message).toBe("Formeln är tom.");
    expect(syntaxError("   ").position).toBe(0);
    expect(syntaxError("a +").position).toBe(3);
    expect(syntaxError("(a + b").message).toContain('Saknar ")"');
    const extra = syntaxError("a b");
    expect(extra.position).toBe(2);
    expect(syntaxError("a + * b").position).toBe(4);
    expect(syntaxError("()").position).toBe(1);
    expect(syntaxError("a )").position).toBe(2);
  });
});

describe("evaluateFormula", () => {
  it("evaluates with operand values", () => {
    expect(
      evalText("sjuktimmar / (timmar + sjuktimmar) * 100", { sjuktimmar: 10, timmar: 90 }),
    ).toBe(10);
  });

  it("propagates null operands (unknown is not zero)", () => {
    expect(evalText("a + b", { a: 1, b: null })).toBeNull();
    expect(evalText("a * 0", { a: null })).toBeNull();
    expect(evalText("-a", { a: null })).toBeNull();
    expect(evalText("a + 1", {})).toBeNull();
  });

  it("returns null on division by zero, also nested", () => {
    expect(evalText("a / b", { a: 5, b: 0 })).toBeNull();
    expect(evalText("0 / 0")).toBeNull();
    expect(evalText("1 + a / (b - b)", { a: 1, b: 3 })).toBeNull();
    expect(evalText("a / b", { a: 0, b: 4 })).toBe(0);
  });

  it("treats non-finite operands as missing", () => {
    expect(evalText("a + 1", { a: Number.NaN })).toBeNull();
    expect(evalText("a + 1", { a: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("referencedKeys", () => {
  it("lists unique keys in order of first appearance", () => {
    expect(referencedKeys(parseFormula("sjuktimmar / (timmar + sjuktimmar) * 100"))).toEqual([
      "sjuktimmar",
      "timmar",
    ]);
    expect(referencedKeys(parseFormula("-b + a * b"))).toEqual(["b", "a"]);
    expect(referencedKeys(parseFormula("42"))).toEqual([]);
  });
});

describe("validateFormulas", () => {
  const base = (key: string, extra: Partial<MetricDefinition> = {}): MetricDefinition => ({
    key,
    name: key,
    unit: "st",
    kind: "sum",
    datasetKey: "ds",
    higherIsBetter: null,
    decimals: null,
    dimensions: [],
    ...extra,
  });
  const formula = (key: string, text: string | null): MetricDefinition =>
    base(key, { kind: "formula", datasetKey: null, formula: text });

  it("accepts the seeded catalog", () => {
    expect(validateFormulas(catalogDefinitions())).toEqual([]);
  });

  it("reports unknown keys", () => {
    const issues = validateFormulas([base("a"), formula("f", "a / okand + b2")]);
    expect(issues).toEqual([
      {
        metricKey: "f",
        code: "unknown_key",
        message: "Okänt mått i formeln: okand, b2.",
        keys: ["okand", "b2"],
      },
    ]);
  });

  it("reports syntax errors and missing formulas", () => {
    const issues = validateFormulas([base("a"), formula("f", "a /"), formula("g", "  ")]);
    expect(issues.map((i) => [i.metricKey, i.code])).toEqual([
      ["f", "syntax"],
      ["g", "missing_formula"],
    ]);
    expect(issues[0]?.position).toBe(3);
  });

  it("detects self references and cycles between formula metrics", () => {
    const issues = validateFormulas([
      base("a"),
      formula("self", "self + 1"),
      formula("x", "y * 2"),
      formula("y", "z + a"),
      formula("z", "x - 1"),
      formula("ok", "x + a"),
    ]);
    const cycles = issues.filter((i) => i.code === "cycle");
    expect(cycles.map((i) => i.metricKey).sort()).toEqual(["self", "x", "y", "z"]);
    expect(cycles.find((i) => i.metricKey === "self")?.keys).toEqual(["self", "self"]);
    expect(cycles.find((i) => i.metricKey === "x")?.keys).toEqual(["x", "y", "z", "x"]);
    expect(cycles.find((i) => i.metricKey === "z")?.keys).toEqual(["z", "x", "y", "z"]);
    expect(cycles.find((i) => i.metricKey === "x")?.message).toBe(
      "Formeln refererar till sig själv: x → y → z → x.",
    );
  });

  it("finds every member of a cycle even when reached through a finished node", () => {
    // b <-> d is found first; c lies on b -> c -> d -> b.
    const issues = validateFormulas([formula("b", "d + c"), formula("d", "b"), formula("c", "d")]);
    expect(issues.map((i) => i.metricKey).sort()).toEqual(["b", "c", "d"]);
    expect(issues.find((i) => i.metricKey === "c")?.keys).toEqual(["c", "d", "b", "c"]);
  });

  it("ignores references from formulas to non-formula metrics when looking for cycles", () => {
    expect(validateFormulas([base("a"), formula("f", "a / a")])).toEqual([]);
  });
});
