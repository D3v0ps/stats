import { describe, expect, it } from "vitest";
import { detectDecimalSeparator, parseNumberSv, type NumberKind } from "./num-sv";

function value(input: string | number | boolean | null, kind: NumberKind = "number") {
  const r = parseNumberSv(input, kind);
  if (!r.ok) throw new Error(`expected ok for ${String(input)}: ${r.reason}`);
  return r.value;
}

function failure(input: string | number | boolean | null, kind: NumberKind = "number") {
  const r = parseNumberSv(input, kind);
  if (r.ok) throw new Error(`expected failure for ${String(input)}, got ${r.value}`);
  return r;
}

describe("parseNumberSv – empty markers", () => {
  it.each(["", "   ", "-", "–", "—", "−", "#N/A", "N/A", "n/a", "#SAKNAS!", " "])(
    "%j is ok null",
    (input) => {
      expect(parseNumberSv(input, "number")).toEqual({ ok: true, value: null });
      expect(parseNumberSv(input, "amount")).toEqual({ ok: true, value: null });
    },
  );

  it("null and undefined are ok null", () => {
    expect(parseNumberSv(null, "amount")).toEqual({ ok: true, value: null });
    expect(parseNumberSv(undefined, "amount")).toEqual({ ok: true, value: null });
  });
});

describe("parseNumberSv – passthrough and invalid types", () => {
  it("passes finite numbers through unchanged", () => {
    expect(value(1234.5)).toBe(1234.5);
    expect(value(-3)).toBe(-3);
    expect(value(0)).toBe(0);
    // Excel time fractions are not converted here.
    expect(value(0.354166, "hours")).toBe(0.354166);
  });

  it("rejects NaN, Infinity and booleans", () => {
    expect(failure(Number.NaN).ok).toBe(false);
    expect(failure(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(failure(true).reason).toMatch(/inte ett tal/);
  });

  it("rejects Excel error values with a clear reason", () => {
    expect(failure("#DIV/0!").reason).toMatch(/Felvärde/);
    expect(failure("#VÄRDEFEL!").reason).toMatch(/Felvärde/);
    expect(failure("#REF!").reason).toMatch(/Felvärde/);
  });

  it("rejects text", () => {
    expect(failure("abc").reason).toMatch(/inte ett tal/);
    expect(failure("12 abc").ok).toBe(false);
    expect(failure("1 2 3").ok).toBe(false);
    expect(failure("12 34").ok).toBe(false);
  });
});

describe("parseNumberSv – thousands and decimals", () => {
  it.each([
    ["1234", 1234],
    ["007", 7],
    ["1 234 567,50", 1234567.5],
    ["1 234 567,50", 1234567.5],
    ["1 234 567,50", 1234567.5],
    ["1 234,5", 1234.5],
    ["1 234", 1234],
    ["1 234.5", 1234.5],
    ["1.234.567,50", 1234567.5],
    ["1.234,5", 1234.5],
    ["1.234.567", 1234567],
    ["1234,5", 1234.5],
    ["1234,567", 1234.567],
    ["12,50", 12.5],
    ["0,125", 0.125],
    ["0.125", 0.125],
    ["1234.5", 1234.5],
    ["8.5", 8.5],
    ["123.4567", 123.4567],
    [",5", 0.5],
    ["+12", 12],
    ["1,23E+11", 123000000000],
    ["1.5e3", 1500],
  ])("%j -> %d", (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  it.each(["1,234.50", "1.234", "1,234", "12,345", "123.456", "1,234,567"])(
    "%j is ambiguous and never guessed",
    (input) => {
      const r = failure(input);
      expect(r.ambiguous).toBe(true);
      expect(r.reason).toMatch(/Tvetydigt/);
    },
  );

  it("rejects malformed grouping", () => {
    expect(failure("1.23.456").ok).toBe(false);
    expect(failure("12.34,5").ok).toBe(false);
    expect(failure("1,2,3").ok).toBe(false);
    expect(failure("1 23,5").ok).toBe(false);
    expect(failure("5,").ok).toBe(false);
  });

  it("resolves ambiguous values with a decimal separator hint", () => {
    expect(parseNumberSv("1.234", "number", { decimalSeparator: "," })).toEqual({
      ok: true,
      value: 1234,
    });
    expect(parseNumberSv("1.234", "number", { decimalSeparator: "." })).toEqual({
      ok: true,
      value: 1.234,
    });
    expect(parseNumberSv("1,234", "number", { decimalSeparator: "," })).toEqual({
      ok: true,
      value: 1.234,
    });
    expect(parseNumberSv("1,234.50", "number", { decimalSeparator: "." })).toEqual({
      ok: true,
      value: 1234.5,
    });
    expect(parseNumberSv("1,234,567", "number", { decimalSeparator: "." })).toEqual({
      ok: true,
      value: 1234567,
    });
  });

  it("rejects values that contradict the hint", () => {
    expect(parseNumberSv("1,234.50", "number", { decimalSeparator: "," }).ok).toBe(false);
    expect(parseNumberSv("1234,5", "number", { decimalSeparator: "." }).ok).toBe(false);
    expect(parseNumberSv("1 234.5", "number", { decimalSeparator: "," }).ok).toBe(false);
  });
});

describe("parseNumberSv – negatives", () => {
  it.each([
    ["-1 200", -1200],
    ["−1 200", -1200],
    ["–1 200", -1200],
    ["1 200-", -1200],
    ["1 200−", -1200],
    ["(1 200)", -1200],
    ["(1 200,50)", -1200.5],
    ["- 5", -5],
    ["-0", 0],
  ])("%j -> %d", (input, expected) => {
    expect(value(input, "amount")).toBe(expected);
  });

  it("never returns negative zero", () => {
    expect(Object.is(value("-0"), 0)).toBe(true);
  });

  it("rejects double negation", () => {
    expect(failure("-(1 200)", "amount").reason).toMatch(/minustecken/);
    expect(failure("-1 200-", "amount").ok).toBe(false);
  });
});

describe("parseNumberSv – units", () => {
  it.each([
    ["1 200 kr", 1200],
    ["1200kr", 1200],
    ["1 200 SEK", 1200],
    ["SEK 1 200", 1200],
    ["1 200:-", 1200],
    ["1 200,-", 1200],
    ["1 200 kronor", 1200],
    ["12 tkr", 12000],
    ["1,2 tkr", 1200],
    ["2,4 mkr", 2400000],
    ["1,1 mkr", 1100000],
    ["-1 200 kr", -1200],
    ["(1 200 kr)", -1200],
    ["1 200 kr-", -1200],
  ])("amount %j -> %d", (input, expected) => {
    expect(value(input, "amount")).toBe(expected);
  });

  it("scales tkr/mkr without float noise", () => {
    expect(value("0,1 tkr", "amount")).toBe(100);
    expect(value("1,15 mkr", "amount")).toBe(1150000);
  });

  it.each([
    ["12,5 %", 12.5],
    ["12,5%", 12.5],
    ["-3 %", -3],
    ["100 procent", 100],
    ["0,125", 0.125],
  ])("percent %j -> %d (percent units)", (input, expected) => {
    expect(value(input, "percent")).toBe(expected);
  });

  it.each([
    ["8,5 h", 8.5],
    ["8,5h", 8.5],
    ["8 tim", 8],
    ["8 timmar", 8],
    ["8:30", 8.5],
    ["7:45", 7.75],
    ["7:45:00", 7.75],
    ["38:30", 38.5],
    ["0:15", 0.25],
    ["8:30 h", 8.5],
    ["-1:30", -1.5],
    ["8 h 30 min", 8.5],
    ["45 min", 0.75],
  ])("hours %j -> %d", (input, expected) => {
    expect(value(input, "hours")).toBe(expected);
  });

  it("rejects invalid clock times", () => {
    expect(failure("8:75", "hours").ok).toBe(false);
    expect(failure("8:5", "hours").ok).toBe(false);
  });

  it("accepts 'st' for counts", () => {
    expect(value("12 st")).toBe(12);
  });

  it("rejects units that do not fit the kind", () => {
    expect(failure("12 %", "amount").reason).toMatch(/Enheten "%"/);
    expect(failure("8 h", "amount").reason).toMatch(/Enheten "h"/);
    expect(failure("1 200 kr", "hours").reason).toMatch(/Enheten "kr"/);
    expect(failure("12 %", "number").ok).toBe(false);
    expect(failure("8:30", "number").ok).toBe(false);
    expect(failure("1 200 kr kr", "amount").ok).toBe(false);
  });

  it("amount markers are not allowed for hours", () => {
    expect(failure("1 200:-", "hours").ok).toBe(false);
  });
});

describe("detectDecimalSeparator", () => {
  it("finds comma evidence", () => {
    expect(detectDecimalSeparator(["1.234", "12,5", "100"])).toBe(",");
    expect(detectDecimalSeparator(["1 234,50 kr"], "amount")).toBe(",");
    expect(detectDecimalSeparator(["1.234.567"])).toBe(",");
  });

  it("finds dot evidence", () => {
    expect(detectDecimalSeparator(["1,234", "8.5"])).toBe(".");
    expect(detectDecimalSeparator(["1 234.5"])).toBe(".");
  });

  it("returns null without or with conflicting evidence", () => {
    expect(detectDecimalSeparator(["1", "2", "1.234"])).toBeNull();
    expect(detectDecimalSeparator(["12,5", "8.5"])).toBeNull();
    expect(detectDecimalSeparator([1.5, null, true])).toBeNull();
  });

  it("lets a column resolve its own ambiguous values", () => {
    const column = ["1.234", "12,5", "999"];
    const sep = detectDecimalSeparator(column) ?? undefined;
    const parsed = column.map((v) => parseNumberSv(v, "number", { decimalSeparator: sep }));
    expect(parsed).toEqual([
      { ok: true, value: 1234 },
      { ok: true, value: 12.5 },
      { ok: true, value: 999 },
    ]);
  });
});
