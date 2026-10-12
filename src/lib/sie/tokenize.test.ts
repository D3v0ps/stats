import { describe, expect, it } from "vitest";
import { tokenizeLine, tokenizeSie, type SieField, type SieLine } from "./tokenize";

function record(line: string): { label: string; fields: SieField[] } {
  const { lines } = tokenizeLine(line, 1);
  const first = lines[0];
  if (first?.kind !== "record") throw new Error(`not a record: ${line}`);
  return { label: first.label, fields: first.fields };
}

const t = (value: string, quoted = false): SieField => ({ kind: "text", value, quoted });
const list = (...items: string[]): SieField => ({ kind: "list", items });

describe("tokenizeLine", () => {
  it("splits a label and bare fields", () => {
    expect(record("#RAR 0 20260101 20261231")).toEqual({
      label: "#RAR",
      fields: [t("0"), t("20260101"), t("20261231")],
    });
  });

  it("reads quoted strings with spaces", () => {
    expect(record('#KONTO 3041 "Försäljning tjänster 25 %"').fields).toEqual([
      t("3041"),
      t("Försäljning tjänster 25 %", true),
    ]);
  });

  it('unescapes \\" inside quoted strings', () => {
    expect(record('#KONTO 6540 "IT-tjänster \\"molnet\\""').fields[1]).toEqual(
      t('IT-tjänster "molnet"', true),
    );
    expect(record('#FNAMN "\\"Citat\\" AB"').fields[0]).toEqual(t('"Citat" AB', true));
  });

  it("keeps a lone backslash", () => {
    expect(record('#PROSA "C:\\export\\fil.se"').fields[0]).toEqual(t("C:\\export\\fil.se", true));
  });

  it("reads empty quoted strings", () => {
    expect(record('#TRANS 1930 {} -100.00 "" "Text"').fields).toEqual([
      t("1930"),
      list(),
      t("-100.00"),
      t("", true),
      t("Text", true),
    ]);
  });

  it("reads object lists", () => {
    expect(record('#TRANS 4600 {1 "100" 6 "P1"} 1000.00').fields[1]).toEqual(
      list("1", "100", "6", "P1"),
    );
    expect(record('#TRANS 4600 {"1" "100"} 1000.00').fields[1]).toEqual(list("1", "100"));
    expect(record("#TRANS 4600 {1 100} 1000.00").fields[1]).toEqual(list("1", "100"));
  });

  it("reads empty object lists, with or without inner spaces", () => {
    expect(record("#PSALDO 0 202601 3041 {} -5.00").fields[3]).toEqual(list());
    expect(record("#PSALDO 0 202601 3041 { } -5.00").fields[3]).toEqual(list());
    expect(record("#PSALDO 0 202601 3041 {}-5.00").fields).toEqual([
      t("0"),
      t("202601"),
      t("3041"),
      list(),
      t("-5.00"),
    ]);
  });

  it("handles quotes and braces inside list items", () => {
    expect(record('#OIB 0 1930 {1 "a}b" 2 "x\\"y"} 5').fields[2]).toEqual(
      list("1", "a}b", "2", 'x"y'),
    );
  });

  it("treats tabs as separators and ignores surrounding whitespace", () => {
    expect(record('\t#TRANS\t3041\t{1\t"100"}\t-1.00\t  ')).toEqual({
      label: "#TRANS",
      fields: [t("3041"), list("1", "100"), t("-1.00")],
    });
  });

  it("uppercases labels", () => {
    expect(record("#konto 3041 x").label).toBe("#KONTO");
  });

  it("recognizes block braces and other lines", () => {
    expect(tokenizeLine("{", 3).lines).toEqual([{ kind: "blockStart", lineNo: 3 }]);
    expect(tokenizeLine("  }  ", 4).lines).toEqual([{ kind: "blockEnd", lineNo: 4 }]);
    expect(tokenizeLine("   ", 5).lines).toEqual([]);
    expect(tokenizeLine("hej", 6).lines).toEqual([{ kind: "other", lineNo: 6, text: "hej" }]);
  });

  it("splits a block opened on the #VER line", () => {
    const { lines } = tokenizeLine('#VER A 1 20260105 "Hyra" {', 7);
    expect(lines).toEqual([
      {
        kind: "record",
        lineNo: 7,
        label: "#VER",
        fields: [t("A"), t("1"), t("20260105"), t("Hyra", true)],
      },
      { kind: "blockStart", lineNo: 7 },
    ]);
  });

  it("reports unterminated quotes and lists but keeps the content", () => {
    const q = tokenizeLine('#FNAMN "Bolaget AB', 1);
    expect(q.issues).toHaveLength(1);
    expect((q.lines[0] as Extract<SieLine, { kind: "record" }>).fields[0]).toEqual(
      t("Bolaget AB", true),
    );
    const l = tokenizeLine('#TRANS 1930 {1 "100" -5.00', 2);
    expect(l.issues.map((i) => i.message)).toEqual(["Objektlistan saknar }"]);
    expect((l.lines[0] as Extract<SieLine, { kind: "record" }>).fields[1]).toEqual(
      list("1", "100", "-5.00"),
    );
  });
});

describe("tokenizeSie", () => {
  it("handles CRLF, LF, CR, empty lines and line numbers", () => {
    const text = '#FLAGGA 0\r\n\r\n#SIETYP 4\n#VER A 1 20260101 "x"\r{\r\n#TRANS 1930 {} 1\n}\n';
    const { lines, issues } = tokenizeSie(text);
    expect(issues).toEqual([]);
    expect(lines.map((l) => [l.kind, l.lineNo])).toEqual([
      ["record", 1],
      ["record", 3],
      ["record", 4],
      ["blockStart", 5],
      ["record", 6],
      ["blockEnd", 7],
    ]);
  });

  it("ignores a leading byte order mark", () => {
    const { lines } = tokenizeSie("\uFEFF#FLAGGA 0");
    expect(lines[0]).toMatchObject({ kind: "record", label: "#FLAGGA" });
  });
});
