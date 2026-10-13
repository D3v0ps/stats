import { describe, expect, it } from "vitest";
import { utf8, xlsBytes, xlsxBytes } from "../testing/workbooks";
import { parseCsv, ReadError, readWorkbook, sniffDelimiter, sniffFormat } from "./index";

const cp1252 = (s: string) =>
  new Uint8Array(
    Array.from(s, (ch) => {
      const code = ch.charCodeAt(0);
      if (code > 0xff) throw new Error("not latin1");
      return code;
    }),
  );

describe("sniffFormat", () => {
  it("detects by magic bytes, not by extension", () => {
    expect(sniffFormat(xlsxBytes([{ name: "A", rows: [["x"]] }]))).toBe("xlsx");
    expect(sniffFormat(xlsBytes([{ name: "A", rows: [["x"]] }]))).toBe("xls");
    expect(sniffFormat(utf8("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniffFormat(utf8("#FLAGGA 0\n#PROGRAM Fortnox\n"))).toBe("sie");
    expect(sniffFormat(utf8("#SIETYP 4\n"))).toBe("sie");
    expect(sniffFormat(utf8("<html><body><table></table></body></html>"))).toBe("html");
    expect(sniffFormat(utf8("  \n<table><tr><td>a</td></tr></table>"))).toBe("html");
    expect(sniffFormat(utf8("Rapport\r\n<TABLE border=1><tr><td>a</td></tr></TABLE>"))).toBe(
      "html",
    );
    expect(sniffFormat(utf8("Kund;Timmar\nAcme;8,5\n"))).toBe("csv");
    expect(sniffFormat(new Uint8Array())).toBe("csv");
  });

  it("detects SIE behind a UTF-8 BOM and SpreadsheetML as xls", () => {
    expect(sniffFormat(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("#FLAGGA 0")]))).toBe("sie");
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"></Workbook>`;
    expect(sniffFormat(utf8(xml))).toBe("xls");
  });
});

describe("sniffDelimiter", () => {
  it("prefers ';' for Swedish exports with decimal commas", () => {
    expect(sniffDelimiter("Kund;Timmar;Belopp\nAcme;8,5;1200\nBeta;7,25;900\n")).toBe(";");
  });

  it("detects commas, tabs and semicolons", () => {
    expect(sniffDelimiter("Kund,Timmar\nAcme,8.5\nBeta,7\n")).toBe(",");
    expect(sniffDelimiter("Kund\tTimmar\nAcme\t8,5\nBeta\t7\n")).toBe("\t");
    expect(sniffDelimiter('a;"b;c";d\n1;2;3\n')).toBe(";");
  });

  it("breaks ties in favour of ';'", () => {
    expect(sniffDelimiter("a;b,c\nd;e,f\n")).toBe(";");
    expect(sniffDelimiter("single column\nonly\n")).toBe(";");
  });

  it("prefers ';' even when commas inside values would give more fields", () => {
    expect(sniffDelimiter("Andersson, Anna;8,5\nBerg, Bo;7,25\nÅberg, Åsa;6,5\n")).toBe(";");
  });

  it("ignores title lines above the table", () => {
    expect(sniffDelimiter("Rapport timmar, september\n\nKund;Timmar\nAcme;8\nBeta;9\n")).toBe(";");
  });
});

describe("parseCsv", () => {
  it("keeps quoted newlines and delimiters inside a cell", () => {
    const { rows } = parseCsv('Kund;Kommentar\nAcme;"rad 1\nrad 2; med semikolon"\n', ";");
    expect(rows).toHaveLength(2);
    expect(rows[1]![1]).toEqual({
      v: "rad 1\nrad 2; med semikolon",
      w: "rad 1\nrad 2; med semikolon",
      t: "s",
    });
  });

  it("keeps every cell as a string and empty cells as z", () => {
    const { rows, delimiter } = parseCsv("a;b;c\n1;;3,5\n\n");
    expect(delimiter).toBe(";");
    expect(rows).toEqual([
      [
        { v: "a", w: "a", t: "s" },
        { v: "b", w: "b", t: "s" },
        { v: "c", w: "c", t: "s" },
      ],
      [
        { v: "1", w: "1", t: "s" },
        { v: null, t: "z" },
        { v: "3,5", w: "3,5", t: "s" },
      ],
    ]);
  });

  it("handles CRLF and escaped quotes", () => {
    const { rows } = parseCsv('a;b\r\n"x ""y""";2\r\n');
    expect(rows[1]![0]!.v).toBe('x "y"');
  });

  it("never throws on unbalanced quotes", () => {
    expect(() => parseCsv('a;b\n"open;2\n')).not.toThrow();
  });
});

describe("parseCsv – Excel's 'sep=' hint line", () => {
  it("uses the declared delimiter and drops the hint line", () => {
    const { rows, delimiter } = parseCsv('sep=,\nKund,Belopp\nAcme;AB,"1,5"\n');
    expect(delimiter).toBe(",");
    expect(rows.map((r) => r.map((c) => c.v))).toEqual([
      ["Kund", "Belopp"],
      ["Acme;AB", "1,5"],
    ]);
    expect(readWorkbook(utf8("SEP=;\r\nKund;Timmar\r\nAcme;8,5\r\n"), "x.csv")).toMatchObject({
      delimiter: ";",
      sheets: [
        {
          rows: [
            [{ v: "Kund" }, { v: "Timmar" }],
            [{ v: "Acme" }, { v: "8,5" }],
          ],
        },
      ],
    });
  });
});

describe("readWorkbook – csv", () => {
  it("reads UTF-8 with BOM, detects ';' and keeps strings", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...utf8("Kund;Ort;Timmar\nÅkesson;Malmö;8,5\n"),
    ]);
    const wb = readWorkbook(bytes, "timmar.csv");
    expect(wb).toMatchObject({ format: "csv", encoding: "utf-8", delimiter: ";", date1904: false });
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]!.name).toBe("timmar");
    expect(wb.sheets[0]!.rows[1]!.map((c) => c.v)).toEqual(["Åkesson", "Malmö", "8,5"]);
  });

  it("reads Windows-1252 exports", () => {
    const wb = readWorkbook(cp1252("Kund;Ort\nÖrebro Bygg;Gävle\n"), "export.txt");
    expect(wb.encoding).toBe("windows-1252");
    expect(wb.sheets[0]!.rows[1]!.map((c) => c.v)).toEqual(["Örebro Bygg", "Gävle"]);
  });

  it("reads UTF-16LE tab-separated 'Unicode text' from Excel", () => {
    const text = "Kund\tTimmar\r\nÅre AB\t8,5\r\n";
    const bytes = [0xff, 0xfe];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      bytes.push(c & 0xff, c >> 8);
    }
    const wb = readWorkbook(new Uint8Array(bytes), "export.txt");
    expect(wb).toMatchObject({ format: "csv", encoding: "utf-16le", delimiter: "\t" });
    expect(wb.sheets[0]!.rows[1]!.map((c) => c.v)).toEqual(["Åre AB", "8,5"]);
  });

  it("returns an empty sheet for an empty file", () => {
    const wb = readWorkbook(new Uint8Array(), "tom.csv");
    expect(wb.sheets[0]!.rows).toEqual([]);
  });
});

describe("readWorkbook – xlsx", () => {
  const bytes = xlsxBytes([
    {
      name: "Timmar",
      rows: [
        ["Rapport timmar"],
        ["Miljonbemanning AB"],
        [],
        ["Kund", "Datum", "Timmar", "Andel", "Tid"],
        ["Acme", 46295, 8.5, 0.125, 0.354166666],
        ["Beta", 46296, 7, 0.5, 0.3125],
        ["Totalt", null, 15.5, null, null],
      ],
      merges: ["A1:E1"],
      formats: { B5: "yyyy-mm-dd", B6: "yyyy-mm-dd", D5: "0.0%", E5: "[h]:mm", E6: "h:mm" },
    },
    { name: "Dold", rows: [["hemlig"]], hidden: true },
  ]);
  const wb = readWorkbook(bytes, "rapport.xls");

  it("reads format, sheets, hidden flags and merges", () => {
    expect(wb.format).toBe("xlsx");
    expect(wb.date1904).toBe(false);
    expect(wb.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ["Timmar", false],
      ["Dold", true],
    ]);
    expect(wb.sheets[0]!.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }]);
  });

  it("builds dense rows with raw value, display text and type", () => {
    const rows = wb.sheets[0]!.rows;
    expect(rows[2]).toEqual([]);
    expect(rows[3]!.map((c) => c.v)).toEqual(["Kund", "Datum", "Timmar", "Andel", "Tid"]);
    expect(rows[4]![0]).toMatchObject({ v: "Acme", t: "s" });
    expect(rows[4]![2]).toMatchObject({ v: 8.5, t: "n" });
  });

  it("marks date-formatted numbers as t:'d' and keeps the format code in f", () => {
    const cell = wb.sheets[0]!.rows[4]![1]!;
    expect(cell).toEqual({ v: 46295, w: "2026-09-30", t: "d", f: "yyyy-mm-dd" });
  });

  it("does not mark time-only or percent formats as dates", () => {
    const row = wb.sheets[0]!.rows[4]!;
    expect(row[3]).toMatchObject({ v: 0.125, t: "n", f: "0.0%" });
    expect(row[4]).toMatchObject({ t: "n", f: "[h]:mm" });
    expect(wb.sheets[0]!.rows[5]![4]).toMatchObject({ t: "n", f: "h:mm" });
  });

  it("reads the 1904 date system flag", () => {
    const wb1904 = readWorkbook(
      xlsxBytes([{ name: "S", rows: [["d"], [1000]], formats: { A2: "yyyy-mm-dd" } }], {
        date1904: true,
      }),
      "mac.xlsx",
    );
    expect(wb1904.date1904).toBe(true);
    expect(wb1904.sheets[0]!.rows[1]![0]).toMatchObject({ v: 1000, t: "d" });
  });

  it("throws ReadError for a corrupt zip", () => {
    expect(() => readWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "x.xlsx")).toThrow(
      ReadError,
    );
  });
});

describe("readWorkbook – xls (BIFF8)", () => {
  it("reads legacy binary workbooks incl. hidden sheets and dates", () => {
    const bytes = xlsBytes([
      {
        name: "Data",
        rows: [
          ["Kund", "Datum"],
          ["Acme", 46295],
        ],
        formats: { B2: "yyyy-mm-dd" },
      },
      { name: "Dold", rows: [["x"]], hidden: true },
    ]);
    const wb = readWorkbook(bytes, "gammal.xls");
    expect(wb.format).toBe("xls");
    expect(wb.sheets.map((s) => s.hidden)).toEqual([false, true]);
    expect(wb.sheets[0]!.rows[1]![1]).toMatchObject({ v: 46295, t: "d" });
  });
});

describe("readWorkbook – html '.xls'", () => {
  const html = `<html><head><meta charset="utf-8"></head><body>
    <table>
      <tr><td colspan="3">Timrapport september 2026</td></tr>
      <tr><td>Kund</td><td>Timmar</td><td>Datum</td></tr>
      <tr><td>Åkesson&nbsp;AB</td><td>8,5</td><td>2026-09-30</td></tr>
      <tr><td>Beta</td><td>1&nbsp;200</td><td>30/9 2026</td></tr>
      <tr><td>Summa</td><td>1&nbsp;208,5</td><td></td></tr>
    </table></body></html>`;
  const wb = readWorkbook(utf8(html), "timmar.xls");

  it("is read as html with text cells exactly as shown", () => {
    expect(wb.format).toBe("html");
    expect(wb.encoding).toBe("utf-8");
    const rows = wb.sheets[0]!.rows;
    expect(rows[2]!.map((c) => c.v)).toEqual(["Åkesson AB", "8,5", "2026-09-30"]);
    expect(rows[3]!.map((c) => c.t)).toEqual(["s", "s", "s"]);
    expect(rows[3]![1]!.v).toBe("1 200");
  });

  it("copies colspan merges", () => {
    expect(wb.sheets[0]!.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]);
  });

  it("decodes Windows-1252 html", () => {
    const wb1252 = readWorkbook(cp1252("<table><tr><td>Göteborg</td></tr></table>"), "x.xls");
    expect(wb1252.encoding).toBe("windows-1252");
    expect(wb1252.sheets[0]!.rows[0]![0]!.v).toBe("Göteborg");
  });

  it("decodes named and numeric character references in cells", () => {
    const entities = readWorkbook(
      utf8(
        `<table><tr><th>Arbetsst&auml;lle</th><th>Kund</th></tr>` +
          `<tr><td>S&ouml;dert&auml;lje&nbsp;</td><td>Ica &amp; Coop</td></tr>` +
          `<tr><td>&Aring;rsta</td><td>&#214;rebro &#xE5;keri</td></tr>` +
          `<tr><td>&lt;b&gt;</td><td>&#60;i&#62; &amp;ouml;</td></tr></table>`,
      ),
      "kundlista.xls",
    );
    const rows = entities.sheets[0]!.rows.map((r) => r.map((c) => c.v));
    expect(rows).toEqual([
      ["Arbetsställe", "Kund"],
      ["Södertälje ", "Ica & Coop"],
      ["Årsta", "Örebro åkeri"],
      ["<b>", "<i> &ouml;"],
    ]);
  });

  it("drops referenced direction marks, so headers read as shown", () => {
    const marked = readWorkbook(
      utf8(`<table><tr><th>Kund&lrm;</th><th>&#x200F;Ort</th></tr></table>`),
      "kundlista.xls",
    );
    expect(marked.sheets[0]!.rows[0]!.map((c) => c.v)).toEqual(["Kund", "Ort"]);
  });
});

describe("readWorkbook – sie, pdf, xml", () => {
  it("returns no sheets for SIE and PDF", () => {
    expect(readWorkbook(utf8("#FLAGGA 0\n#SIETYP 4\n"), "bok.se")).toMatchObject({
      format: "sie",
      sheets: [],
    });
    expect(readWorkbook(utf8("%PDF-1.4"), "rapport.pdf")).toMatchObject({
      format: "pdf",
      sheets: [],
    });
  });

  it("reads SpreadsheetML 2003", () => {
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Blad1"><Table><Row><Cell><Data ss:Type="String">Kund</Data></Cell><Cell><Data ss:Type="String">Timmar</Data></Cell></Row><Row><Cell><Data ss:Type="String">Acme</Data></Cell><Cell><Data ss:Type="Number">8.5</Data></Cell></Row></Table></Worksheet></Workbook>`;
    const wb = readWorkbook(utf8(xml), "export.xls");
    expect(wb.format).toBe("xls");
    expect(wb.sheets[0]!.rows[1]![1]).toMatchObject({ v: 8.5, t: "n" });
  });
});

describe("readWorkbook – html '.xls' with several tables", () => {
  const html = `<html><head><meta charset="utf-8"></head><body>
    <table><tr><td colspan="3">Timrapport MB AB september 2026</td></tr></table>
    <table>
      <tr><th>Kund</th><th>Timmar</th><th>Belopp</th></tr>
      <tr><td>Acme</td><td>8,5</td><td>1&nbsp;234,50</td></tr>
      <tr><td>Beta</td><td>7</td><td>2 000</td></tr>
    </table></body></html>`;

  it("stacks the tables into one sheet like Excel does, so a title table becomes meta lines", () => {
    const wb = readWorkbook(utf8(html), "timmar.xls");
    expect(wb.sheets).toHaveLength(1);
    const rows = wb.sheets[0]!.rows;
    expect(rows[0]!.map((c) => c.v)).toEqual(["Timrapport MB AB september 2026"]);
    expect(rows[1]).toEqual([]);
    expect(rows[2]!.map((c) => c.v)).toEqual(["Kund", "Timmar", "Belopp"]);
    expect(rows[4]!.map((c) => c.v)).toEqual(["Beta", "7", "2 000"]);
    expect(wb.sheets[0]!.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]);
  });

  it("offsets merges of later tables", () => {
    const two = `<table><tr><td>Rapport</td></tr></table><table><tr><td colspan="2">Grupp</td></tr><tr><td>a</td><td>b</td></tr></table>`;
    const wb = readWorkbook(utf8(two), "x.xls");
    expect(wb.sheets[0]!.merges).toEqual([{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }]);
  });
});

describe("readWorkbook – text that merely starts with '<'", () => {
  it("reads a CSV whose first cell starts with '<' as CSV instead of failing as HTML", () => {
    const wb = readWorkbook(utf8("<Kund>;Belopp\nAcme;1\nBeta;2\n"), "x.csv");
    expect(wb.format).toBe("csv");
    expect(wb.sheets[0]!.rows[1]!.map((c) => c.v)).toEqual(["Acme", "1"]);
  });

  it("still sniffs real HTML starting with a tag", () => {
    expect(sniffFormat(utf8("<!DOCTYPE html><html><body>x</body></html>"))).toBe("html");
    expect(sniffFormat(utf8("<HTML><BODY>x</BODY></HTML>"))).toBe("html");
    expect(sniffFormat(utf8("<meta charset='utf-8'><div>x</div>"))).toBe("html");
  });
});
