import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  FactDraftSchema,
  ImportTemplateSchema,
  UploadCreateSchema,
  type ImportTemplate,
  type IngestResult,
} from "@/lib/contracts";
import { sha256Hex } from "@/lib/core/hash";
import { PersonalDataError } from "./aggregate";
import { readWorkbook } from "./read";
import { IngestError, factsContentHash, loadTable, runTemplate } from "./run";
import { utf8, xlsxBytes } from "./testing/workbooks";

const aliases = {
  verksamhet: { bemanning: "Bemanning", krom: "KROM", "rusta och matcha 2": "ROM2" },
};

const timmarTemplate: ImportTemplate = ImportTemplateSchema.parse({
  datasetKey: "ip_timmar",
  name: "Intelliplan timmar",
  headerSignature: ["kund", "datum", "anställnings id", "personnummer", "timmar", "status"],
  sheetHint: "Timmar",
  config: {
    kind: "table",
    steps: [
      { op: "filter", column: "status", operator: "not_equals", value: "Attesterad" },
      { op: "constant", column: "verksamhet", value: "Bemanning" },
      { op: "lookup", column: "verksamhet", dimension: "verksamhet" },
    ],
    columns: [
      { column: "kund", type: "text", usage: "dimension", dimensionKey: "kund" },
      { column: "datum", type: "date", usage: "period" },
      { column: "anställnings id", type: "text", usage: "dimension", dimensionKey: "konsult" },
      { column: "personnummer", type: "text", usage: "ignore", personal: true, keep: false },
      { column: "timmar", type: "hours", usage: "measure", metricKey: "timmar" },
      { column: "status", type: "text", usage: "ignore" },
      { column: "verksamhet", type: "text", usage: "dimension", dimensionKey: "verksamhet" },
    ],
    counters: [{ metricKey: "pass", kind: "count_rows" }],
    period: { kind: "column", column: "datum" },
    company: { kind: "per_upload" },
  },
});

function timmarFile(rows: (string | number | null)[][]) {
  return xlsxBytes([
    { name: "Info", rows: [["Exporterad från Intelliplan"]], hidden: true },
    {
      name: "Timmar",
      rows: [
        ["Timrapport Miljonbemanning AB"],
        ["Period: 2026-09-01 - 2026-09-30"],
        [],
        ["Kund", "Datum", "Anställnings id", "Personnummer", "Timmar", "Status"],
        ...rows,
        ["Totalt", null, null, null, 31.5, null],
        [],
        ["Utskrivet 2026-10-01"],
      ],
      formats: Object.fromEntries(rows.map((_, i) => [`B${i + 5}`, "yyyy-mm-dd"])),
    },
  ]);
}

const ROWS: (string | number | null)[][] = [
  ["Acme AB", 46266, "1001", "121212-1212", 8, "Attesterad"],
  ["Acme AB", 46267, "1002", "701063-2391", 7.5, "Attesterad"],
  ["Beta AB", 46268, "1001", null, 8, "Attesterad"],
  ["Beta AB", 46269, "1003", null, 8, "Utkast"],
];

async function runTimmar(bytes: Uint8Array, name = "intelliplan_timmar_MBAB_2026-09.xlsx") {
  const wb = readWorkbook(bytes, name);
  return runTemplate(
    wb,
    timmarTemplate,
    { company: "MBAB" },
    {
      aliases,
      fileSha256: await sha256Hex(bytes),
      fileSize: bytes.length,
    },
  );
}

describe("runTemplate – table template on an Intelliplan-style xlsx", () => {
  const bytes = timmarFile(ROWS);
  let result: IngestResult;

  it("produces facts, totals and slices", async () => {
    result = await runTimmar(bytes);
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.datasetKey).toBe("ip_timmar");
    expect(result.scenario).toBe("utfall");
    expect(result.companies).toEqual(["MBAB"]);
    expect(result.slices).toEqual([{ company: "MBAB", month: "2026-09" }]);
    expect(result.facts.filter((f) => f.metricKey === "timmar")).toEqual([
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-09",
        dims: { konsult: "1001", kund: "Acme AB", verksamhet: "Bemanning" },
        value: 8,
        sourceRows: [5],
      },
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-09",
        dims: { konsult: "1001", kund: "Beta AB", verksamhet: "Bemanning" },
        value: 8,
        sourceRows: [7],
      },
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-09",
        dims: { konsult: "1002", kund: "Acme AB", verksamhet: "Bemanning" },
        value: 7.5,
        sourceRows: [6],
      },
    ]);
    expect(result.totals).toEqual([
      { metricKey: "pass", company: "MBAB", month: "2026-09", value: 3 },
      { metricKey: "timmar", company: "MBAB", month: "2026-09", value: 23.5 },
    ]);
  });

  it("fills the parse report", () => {
    expect(result.report).toMatchObject({
      rowsRead: 6,
      rowsUsed: 3,
      sheet: "Timmar",
      headerRow: 4,
      issues: [],
      warnings: [],
    });
    expect(result.report.skipped.map((s) => [s.sourceRow, s.reason])).toEqual([
      [8, "filtered"],
      [9, "sum_row"],
      [10, "empty"],
      [11, "footer"],
    ]);
    expect(result.file).toEqual({
      name: "intelliplan_timmar_MBAB_2026-09.xlsx",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      size: bytes.length,
    });
  });

  it("never leaks personnummer from removed columns", () => {
    const json = JSON.stringify(result);
    expect(json).not.toContain("121212");
    expect(json).not.toContain("701063");
  });

  it("satisfies the contracts for staging", () => {
    for (const f of result.facts) expect(() => FactDraftSchema.parse(f)).not.toThrow();
    expect(() =>
      UploadCreateSchema.parse({
        datasetKey: result.datasetKey,
        templateId: null,
        templateVersion: null,
        scenario: result.scenario,
        fileName: result.file.name,
        fileSha256: result.file.sha256,
        fileSize: result.file.size,
        contentHash: result.contentHash,
        engineVersion: result.engineVersion,
        asOfDate: null,
        slices: result.slices,
        parseReport: result.report,
        totals: result.totals,
      }),
    ).not.toThrow();
  });

  it("gives the same content hash for reordered rows and a new one for changed numbers", async () => {
    const reordered = await runTimmar(timmarFile([...ROWS].reverse()));
    expect(reordered.contentHash).toBe(result.contentHash);
    expect(reordered.file.sha256).not.toBe(result.file.sha256);
    const changed = await runTimmar(
      timmarFile([["Acme AB", 46266, "1001", null, 9, "Attesterad"], ...ROWS.slice(1)]),
    );
    expect(changed.contentHash).not.toBe(result.contentHash);
  });

  it("warns about column drift and unknown lookups", async () => {
    const drifted = xlsxBytes([
      {
        name: "Timmar",
        rows: [
          ["Kund", "Datum", "Anställningsid", "Timmar", "Status", "Program"],
          ["Acme AB", "2026-09-01", "1001", 8, "Attesterad", "x"],
        ],
      },
    ]);
    const template: ImportTemplate = {
      ...timmarTemplate,
      config: {
        ...timmarTemplate.config,
        steps: [{ op: "lookup", column: "program", dimension: "verksamhet" }],
      } as ImportTemplate["config"],
    };
    const wb = readWorkbook(drifted, "x.xlsx");
    const r = await runTemplate(
      wb,
      template,
      { company: "MBAB" },
      { aliases, fileSha256: "0".repeat(64), fileSize: 1 },
    );
    expect(r.report.warnings.join("\n")).toMatch(/Kolumnerna skiljer sig från mallen/);
    expect(r.report.warnings.join("\n")).toMatch(/bytt namn: anställnings id → anställningsid/);
    expect(r.report.warnings.join("\n")).toMatch(/Okända värden för verksamhet: x/);
    expect(r.report.issues.some((i) => i.column === "anställnings id")).toBe(true);
  });

  it("refuses to produce facts from a kept personnummer column", async () => {
    const cfg = timmarTemplate.config;
    if (cfg.kind !== "table") throw new Error("unreachable");
    const leaky: ImportTemplate = {
      ...timmarTemplate,
      config: {
        ...cfg,
        columns: cfg.columns.map((c) => {
          if (c.column === "personnummer") {
            return { ...c, usage: "dimension" as const, dimensionKey: "konsult", keep: true };
          }
          return c.column === "anställnings id" ? { ...c, keep: false } : c;
        }),
      },
    };
    const wb = readWorkbook(bytes, "x.xlsx");
    await expect(
      runTemplate(
        wb,
        leaky,
        { company: "MBAB" },
        { aliases, fileSha256: "0".repeat(64), fileSize: 1 },
      ),
    ).rejects.toThrow(PersonalDataError);
  });

  it("never puts personnummer into the parse report or the file name", async () => {
    const cfg = timmarTemplate.config;
    if (cfg.kind !== "table") throw new Error("unreachable");
    const noisy: ImportTemplate = {
      ...timmarTemplate,
      config: {
        ...cfg,
        steps: [
          ...cfg.steps,
          // Steps may touch removed columns; their issues must not carry the values.
          { op: "clean", column: "personnummer", as: "number" },
          { op: "lookup", column: "personnummer", dimension: "konsult" },
        ],
      },
    };
    const wb = readWorkbook(bytes, "lönelista 121212-1212.xlsx");
    const r = await runTemplate(
      wb,
      noisy,
      { company: "MBAB" },
      { aliases, fileSha256: "0".repeat(64), fileSize: 1 },
    );
    expect(r.report.issues.length).toBeGreaterThan(0);
    expect(r.report.warnings.join("\n")).toMatch(/Okända värden för konsult/);
    const json = JSON.stringify(r);
    expect(json).not.toContain("121212");
    expect(json).not.toContain("701063");
    expect(r.file.name).toBe("lönelista ÅÅMMDD-XXXX.xlsx");
    expect(r.report.issues[0]!.value).toBe("ÅÅMMDD-XXXX");
  });

  it("honours a user-picked header row", async () => {
    const wb = readWorkbook(bytes, "x.xlsx");
    const r = await runTemplate(
      wb,
      timmarTemplate,
      { company: "MBAB" },
      {
        aliases,
        fileSha256: "0".repeat(64),
        fileSize: 1,
        headerRow: 3,
      },
    );
    expect(r.report.headerRow).toBe(4);
    expect(r.facts.length).toBeGreaterThan(0);
  });
});

describe("runTemplate – cases template on a Workbuster-style CSV", () => {
  const template: ImportTemplate = ImportTemplateSchema.parse({
    datasetKey: "wb_deltagare",
    name: "Workbuster deltagare",
    headerSignature: [
      "gen-nummer",
      "tjänst",
      "ort",
      "startdatum",
      "slutdatum",
      "avbrott",
      "resultat",
    ],
    config: {
      kind: "cases",
      steps: [{ op: "lookup", column: "tjänst", dimension: "verksamhet" }],
      columns: [
        { column: "gen-nummer", type: "text", usage: "case_key" },
        { column: "tjänst", type: "text", usage: "dimension", dimensionKey: "verksamhet" },
        { column: "ort", type: "text", usage: "dimension", dimensionKey: "ort" },
        { column: "startdatum", type: "date", usage: "case_start" },
        { column: "slutdatum", type: "date", usage: "case_end" },
        { column: "avbrott", type: "text", usage: "case_interrupt" },
        { column: "resultat", type: "text", usage: "case_result" },
      ],
      cases: {
        keyColumn: "gen-nummer",
        startColumn: "startdatum",
        endColumn: "slutdatum",
        interruptColumn: "avbrott",
        resultColumn: "resultat",
        resultMap: { arbete: "Arbete", studier: "Studier" },
        groupBy: ["tjänst", "ort"],
        metrics: {
          active: "aktiva_deltagare",
          started: "nya_deltagare",
          ended: "avslutade_deltagare",
          interrupted: "avbrott_deltagare",
          results: "resultat_deltagare",
        },
      },
      company: { kind: "per_upload" },
    },
  });
  const csv =
    "﻿Deltagarlista Miljonbemanning Restart AB\n\n" +
    "GEN-nummer;Tjänst;Ort;Startdatum;Slutdatum;Avbrott;Resultat\n" +
    "GEN100;Rusta och matcha 2;Malmö;2026-08-03;2026-09-18;;Arbete\n" +
    "GEN101;KROM;Malmö;2026-09-01;;;\n" +
    "GEN102;KROM;Lund;15/9 2026;30/9 2026;Ja;\n";

  it("produces monthly counts up to the as-of date without the key", async () => {
    const bytes = utf8(csv);
    const wb = readWorkbook(bytes, "workbuster_deltagare_MBR.csv");
    const r = await runTemplate(
      wb,
      template,
      { company: "MBR", asOfDate: "2026-09-30" },
      {
        aliases,
        fileSha256: await sha256Hex(bytes),
        fileSize: bytes.length,
      },
    );
    expect(r.asOfDate).toBe("2026-09-30");
    expect(r.report).toMatchObject({
      encoding: "utf-8",
      delimiter: ";",
      headerRow: 3,
      rowsUsed: 3,
    });
    expect(r.slices).toEqual([
      { company: "MBR", month: "2026-08" },
      { company: "MBR", month: "2026-09" },
    ]);
    const active = r.totals.filter((t) => t.metricKey === "aktiva_deltagare");
    expect(active.map((t) => [t.month, t.value])).toEqual([
      ["2026-08", 1],
      ["2026-09", 1],
    ]);
    const interrupted = r.totals.find(
      (t) => t.metricKey === "avbrott_deltagare" && t.month === "2026-09",
    );
    expect(interrupted?.value).toBe(1);
    expect(
      r.facts.find((f) => f.metricKey === "resultat_deltagare" && f.value === 1)?.dims,
    ).toEqual({
      ort: "Malmö",
      resultattyp: "Arbete",
      verksamhet: "ROM2",
    });
    expect(JSON.stringify(r)).not.toMatch(/GEN10\d/);
    for (const f of r.facts) expect(() => FactDraftSchema.parse(f)).not.toThrow();
  });

  it("requires an as-of date", async () => {
    const wb = readWorkbook(utf8(csv), "x.csv");
    await expect(
      runTemplate(
        wb,
        template,
        { company: "MBR" },
        { aliases, fileSha256: "0".repeat(64), fileSize: 1 },
      ),
    ).rejects.toThrow(IngestError);
  });
});

describe("runTemplate – other inputs", () => {
  it("reads an HTML '.xls' export end-to-end", async () => {
    const html = `<html><body><table>
      <tr><td>Kund</td><td>Datum</td><td>Belopp</td></tr>
      <tr><td>Acme</td><td>2026-09-03</td><td>1&nbsp;200,50</td></tr>
      <tr><td>Beta</td><td>2026-09-04</td><td>800</td></tr>
      <tr><td>Summa</td><td></td><td>2&nbsp;000,50</td></tr>
    </table></body></html>`;
    const template = ImportTemplateSchema.parse({
      datasetKey: "fx_kundforsaljning",
      name: "Fortnox kundförsäljning",
      headerSignature: ["kund", "datum", "belopp"],
      config: {
        kind: "table",
        columns: [
          { column: "kund", type: "text", usage: "dimension", dimensionKey: "kund" },
          { column: "datum", type: "date", usage: "period" },
          { column: "belopp", type: "amount", usage: "measure", metricKey: "fakturerat_kund" },
        ],
        period: { kind: "column", column: "datum" },
        company: { kind: "fixed", company: "MBAB" },
      },
    });
    const wb = readWorkbook(utf8(html), "kundforsaljning.xls");
    expect(wb.format).toBe("html");
    const r = await runTemplate(
      wb,
      template,
      {},
      { aliases: {}, fileSha256: "0".repeat(64), fileSize: 1 },
    );
    expect(r.totals).toEqual([
      { metricKey: "fakturerat_kund", company: "MBAB", month: "2026-09", value: 2000.5 },
    ]);
    expect(r.report.skipped.map((s) => s.reason)).toEqual(["sum_row"]);
  });

  it("stores budget amounts in SIE sign using the account group signs from the context", async () => {
    const csv = "Post;Månad;Belopp\nIntäkter;2026-01;1000\nPersonalkostnader;2026-01;400\n";
    const template = (budgetSign: "positive" | "result") =>
      ImportTemplateSchema.parse({
        datasetKey: "budget",
        name: "Budget",
        headerSignature: ["post", "månad", "belopp"],
        config: {
          kind: "table",
          columns: [
            { column: "post", type: "text", usage: "dimension", dimensionKey: "kontogrupp" },
            { column: "månad", type: "text", usage: "period" },
            { column: "belopp", type: "amount", usage: "measure", metricKey: "budget_belopp" },
          ],
          period: { kind: "column", column: "månad" },
          company: { kind: "fixed", company: "MBR" },
          scenario: "budget",
          budgetSign,
        },
      });
    const ctx = {
      aliases: {},
      fileSha256: "0".repeat(64),
      fileSize: 1,
      accountGroupSigns: { intakter: -1, personal: 1 } as Record<string, 1 | -1>,
      accountGroupNames: { intakter: "Intäkter", personal: "Personalkostnader" },
    };
    const wb = readWorkbook(utf8(csv), "budget.csv");
    const positive = await runTemplate(wb, template("positive"), {}, ctx);
    expect(positive.scenario).toBe("budget");
    expect(positive.facts.map((f) => [f.dims.kontogrupp, f.value])).toEqual([
      ["Intäkter", -1000],
      ["Personalkostnader", 400],
    ]);
    expect(positive.totals).toEqual([
      { metricKey: "budget_belopp", company: "MBR", month: "2026-01", value: -600 },
    ]);
    // Read as a result budget every amount is negated, whatever its account group.
    const result = await runTemplate(wb, template("result"), {}, ctx);
    expect(result.facts.map((f) => f.value)).toEqual([-1000, -400]);
  });

  it("throws for SIE templates and workbooks without sheets", async () => {
    const sie = ImportTemplateSchema.parse({
      datasetKey: "fx_bokforing",
      name: "SIE",
      headerSignature: [],
      config: { kind: "sie" },
    });
    const wb = readWorkbook(utf8("#FLAGGA 0\n"), "bok.se");
    await expect(
      runTemplate(wb, sie, {}, { aliases: {}, fileSha256: "0".repeat(64), fileSize: 1 }),
    ).rejects.toThrow(IngestError);
    await expect(
      runTemplate(
        wb,
        timmarTemplate,
        { company: "MBAB" },
        { aliases: {}, fileSha256: "0".repeat(64), fileSize: 1 },
      ),
    ).rejects.toThrow(/inget kalkylblad/);
  });

  it("warns when nothing could be read", async () => {
    const wb = readWorkbook(utf8("Kund;Datum;Timmar\n"), "tom.csv");
    const r = await runTemplate(
      wb,
      timmarTemplate,
      { company: "MBAB" },
      { aliases: {}, fileSha256: "0".repeat(64), fileSize: 1 },
    );
    expect(r.facts).toEqual([]);
    expect(r.slices).toEqual([]);
    expect(r.report.warnings).toContain("Inga värden kunde läsas från filen.");
  });
});

describe("loadTable and factsContentHash", () => {
  it("loads the hinted sheet and builds the working table", () => {
    const wb = readWorkbook(timmarFile(ROWS), "x.xlsx");
    const { sheet, table, working } = loadTable(wb, { sheetHint: "Timmar" });
    expect(sheet.name).toBe("Timmar");
    expect(table.headerRows).toEqual([3]);
    expect(working.columns).toEqual([
      "kund",
      "datum",
      "anställnings id",
      "personnummer",
      "timmar",
      "status",
    ]);
    expect(working.rows[0]!.values.datum).toBe("2026-09-01");
  });

  it("ignores source rows and order but not values or dims", async () => {
    const f = {
      metricKey: "timmar",
      company: "MBAB" as const,
      month: "2026-09",
      dims: { kund: "A", ort: "B" },
      value: 1,
      sourceRows: [2],
    };
    const g = { ...f, dims: { ort: "B", kund: "A" }, sourceRows: [7, 9] };
    const h = { ...f, metricKey: "pass" };
    expect(await factsContentHash([f, h])).toBe(await factsContentHash([h, g]));
    expect(await factsContentHash([f])).not.toBe(await factsContentHash([{ ...f, value: 2 }]));
    expect(await factsContentHash([f])).not.toBe(
      await factsContentHash([{ ...f, dims: { kund: "A", ort: "C" } }]),
    );
  });
});
