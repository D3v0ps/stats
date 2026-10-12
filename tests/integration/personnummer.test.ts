// Personnummer written with a space, a no-break space or a narrow no-break space between the
// birth date and the serial ("811218 9876", as forms and number formatting write them) are
// caught by the real ingest like the dashed forms: a column that would be stored is refused,
// and a removed column never leaks into the facts, the report or the file name.
import { describe, expect, it } from "vitest";
import { ImportTemplateSchema, type ImportTemplate } from "@/lib/contracts";
import { containsPersonnummer } from "@/lib/core/pnr";
import { PersonalDataError, readWorkbook, runTemplate } from "@/lib/ingest";

// 811218-9876 and 121212-1212 pass the Luhn check.
const SPACED = [
  ["space", "811218 9876"],
  ["12 digits and a space", "19811218 9876"],
  ["no-break space", "811218 9876"],
  ["narrow no-break space", "121212 1212"],
] as const;

const ctx = { aliases: {}, fileSha256: "0".repeat(64), fileSize: 1 };

function template(referensUsage: "dimension" | "ignore"): ImportTemplate {
  return ImportTemplateSchema.parse({
    datasetKey: "ip_timmar",
    name: "Timmar",
    headerSignature: ["kund", "referens", "datum", "timmar"],
    config: {
      kind: "table",
      columns: [
        { column: "kund", type: "text", usage: "dimension", dimensionKey: "kund" },
        referensUsage === "dimension"
          ? { column: "referens", type: "text", usage: "dimension", dimensionKey: "konsult" }
          : { column: "referens", type: "text", usage: "ignore", personal: true, keep: false },
        { column: "datum", type: "date", usage: "period" },
        { column: "timmar", type: "hours", usage: "measure", metricKey: "timmar" },
      ],
      period: { kind: "column", column: "datum" },
      company: { kind: "fixed", company: "MBAB" },
    },
  });
}

function csv(pnr: string): Uint8Array {
  return new TextEncoder().encode(
    [
      "Kund;Referens;Datum;Timmar",
      "Kund A;1001;2026-09-01;8",
      `Kund A;${pnr};2026-09-02;7,5`,
      "Kund B;1003;2026-09-03;4",
    ].join("\n"),
  );
}

describe("personnummer with a space through runTemplate", () => {
  it("stores the column when it holds no personnummer (control)", async () => {
    const r = await runTemplate(
      readWorkbook(csv("1002"), "timmar.csv"),
      template("dimension"),
      {},
      ctx,
    );
    expect(new Set(r.facts.map((f) => f.dims.konsult))).toEqual(new Set(["1001", "1002", "1003"]));
  });

  it.each(SPACED)("refuses a stored column holding one (%s)", async (_name, pnr) => {
    const workbook = readWorkbook(csv(pnr), "timmar.csv");
    await expect(runTemplate(workbook, template("dimension"), {}, ctx)).rejects.toThrow(
      PersonalDataError,
    );
  });

  it.each(SPACED)("keeps a removed column out of every output (%s)", async (_name, pnr) => {
    const workbook = readWorkbook(csv(pnr), `lön ${pnr}.csv`);
    const r = await runTemplate(workbook, template("ignore"), {}, ctx);
    expect(r.facts.reduce((a, f) => (f.metricKey === "timmar" ? a + f.value : a), 0)).toBe(19.5);
    const out = JSON.stringify({ facts: r.facts, report: r.report, totals: r.totals });
    expect(containsPersonnummer(out)).toBe(false);
    expect(out).not.toContain(pnr);
    expect(containsPersonnummer(r.file.name)).toBe(false);
  });
});
