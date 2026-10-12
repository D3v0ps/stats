import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/core/hash";
import type { ImportTemplate } from "@/lib/contracts";
import { utf8, xlsxBytes } from "@/lib/ingest/testing/workbooks";
import { FILE_GONE_MESSAGE, IngestService, type IngestResponse } from "./ingest-service";
import { sieFixtureBytes } from "./test-fixtures";

function expectOk(res: IngestResponse): Extract<IngestResponse, { ok: true }> {
  if (!res.ok) throw new Error(res.error);
  return res;
}

describe("IngestService", () => {
  it("ingests a SIE file right away with its checks", async () => {
    const service = new IngestService();
    const bytes = sieFixtureBytes("mbab_2026_psaldo.se");
    const res = expectOk(
      await service.handle({ op: "read", fileId: "s", fileName: "mbab.se", bytes }),
    );
    if (res.op !== "read") throw new Error("read expected");
    expect(res.format).toBe("sie");
    expect(res.sha256).toBe(await sha256Hex(bytes));
    expect(res.sie?.ledger?.checks.company).toBe("MBAB");
    expect(res.sie?.companies).toEqual(["MBAB"]);
    expect(res.sie?.ledger?.rows.length).toBeGreaterThan(0);
  });

  it("reports an unknown company in a SIE file through the result, not an error", async () => {
    const res = expectOk(
      await new IngestService().handle({
        op: "read",
        fileId: "u",
        fileName: "x.se",
        bytes: sieFixtureBytes("unknown_org.se"),
      }),
    );
    if (res.op !== "read") throw new Error("read expected");
    expect(res.sie?.companies).toEqual([]);
    expect(res.sie?.ledger?.checks.company).toBeNull();
  });

  it("recognizes PDF by content and refuses unreadable files", async () => {
    const service = new IngestService();
    const pdf = await service.handle({
      op: "read",
      fileId: "p",
      fileName: "rapport.xlsx",
      bytes: utf8("%PDF-1.7 ..."),
    });
    expect(pdf).toMatchObject({ ok: true, format: "pdf", sheets: [] });
    const broken = await service.handle({
      op: "read",
      fileId: "b",
      fileName: "trasig.xlsx",
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    });
    expect(broken).toEqual({ ok: false, error: "Filen kunde inte läsas som kalkylblad." });
  });

  it("answers inspect and preview for a small workbook and forgets released files", async () => {
    const service = new IngestService();
    const bytes = xlsxBytes([
      {
        name: "Timmar",
        rows: [
          ["Timrapport MB AB september 2026"],
          [],
          ["Kund", "Namn", "Personnummer", "Timmar"],
          ["Acme AB", "Anna Andersson", "121212-1212", "8,5"],
          ["Beta AB", "Bo Berg", "701063-2391", "7"],
        ],
      },
    ]);
    expectOk(
      await service.handle({
        op: "read",
        fileId: "f",
        fileName: "timmar_MBAB_2026-09.xlsx",
        bytes,
      }),
    );

    const rec = expectOk(
      await service.handle({ op: "recognize", fileId: "f", hints: [], today: "2026-10-12" }),
    );
    if (rec.op !== "recognize") throw new Error("recognize expected");
    const sheet = rec.sheets[rec.defaultSheet]!;
    expect(sheet.signature).toEqual(["kund", "namn", "personnummer", "timmar"]);
    expect(sheet.periodSuggestions[0]?.month).toBe("2026-09");
    expect(sheet.companySuggestion?.company).toBe("MBAB");

    const insp = expectOk(
      await service.handle({ op: "inspect", fileId: "f", datasetKey: "ip_timmar" }),
    );
    if (insp.op !== "inspect") throw new Error("inspect expected");
    expect(insp.columns.map((c) => [c.name, c.personal, c.locked])).toEqual([
      ["kund", false, false],
      ["namn", true, false],
      ["personnummer", true, true],
      ["timmar", false, false],
    ]);
    expect(insp.columns[2]?.samples.join(" ")).not.toMatch(/\d{6}-\d{4}/);
    expect(insp.headerRow).toBe(3);

    const preview = expectOk(
      await service.handle({
        op: "preview",
        fileId: "f",
        steps: [
          { op: "drop", column: "namn" },
          { op: "drop", column: "personnummer" },
          { op: "clean", column: "timmar", as: "hours" },
        ],
        aliases: {},
        measures: [{ column: "timmar", type: "hours" }],
        distinctFor: ["kund"],
      }),
    );
    if (preview.op !== "preview") throw new Error("preview expected");
    expect(preview.columns).toEqual(["kund", "timmar"]);
    expect(preview.rows[0]?.values).toEqual({ kund: "Acme AB", timmar: "8,5" });
    expect(preview.sums.timmar).toEqual({ sum: 15.5, unreadable: 0 });
    expect(preview.distinct.kund).toEqual(["Acme AB", "Beta AB"]);

    await service.handle({ op: "release", fileId: "f" });
    expect(await service.handle({ op: "inspect", fileId: "f" })).toEqual({
      ok: false,
      error: FILE_GONE_MESSAGE,
    });
  });

  it("also reads each sheet at the header rows saved with templates", async () => {
    const service = new IngestService();
    const bytes = xlsxBytes([
      {
        name: "Data",
        rows: [
          ["Rapport", "Export"],
          ["Kod", "Text"],
          ["Kund", "Timmar"],
          ["Acme AB", "8"],
          ["Beta AB", "7"],
        ],
      },
    ]);
    expectOk(await service.handle({ op: "read", fileId: "h", fileName: "data.xlsx", bytes }));
    const rec = expectOk(
      await service.handle({
        op: "recognize",
        fileId: "h",
        hints: [],
        today: "2026-10-12",
        headerRows: [{ row: 2 }, { sheetHint: "Data", row: 2 }, { row: 40 }],
      }),
    );
    if (rec.op !== "recognize") throw new Error("recognize expected");
    expect(rec.signaturesAt).toEqual({ Data: { 2: ["kund", "timmar"] } });
    const plain = expectOk(
      await service.handle({ op: "recognize", fileId: "h", hints: [], today: "2026-10-12" }),
    );
    expect(plain).toMatchObject({ signaturesAt: {} });
  });

  it("applies budgets with every amount positive using the account groups it is given", async () => {
    const service = new IngestService();
    const bytes = utf8("Kontogrupp;Belopp\nIntäkter;1000\nPersonal;400\n");
    expectOk(await service.handle({ op: "read", fileId: "b", fileName: "budget.csv", bytes }));
    const template: ImportTemplate = {
      datasetKey: "budget",
      name: "Budget",
      headerSignature: ["kontogrupp", "belopp"],
      version: 1,
      config: {
        kind: "table",
        steps: [],
        columns: [
          {
            column: "kontogrupp",
            type: "text",
            usage: "dimension",
            dimensionKey: "kontogrupp",
            personal: false,
            keep: true,
          },
          {
            column: "belopp",
            type: "amount",
            usage: "measure",
            metricKey: "budget_belopp",
            personal: false,
            keep: true,
          },
        ],
        counters: [],
        period: { kind: "per_upload" },
        company: { kind: "fixed", company: "MBAB" },
        scenario: "budget",
        budgetSign: "positive",
      },
    };
    const run = (extra: object) =>
      service.handle({
        op: "apply",
        fileId: "b",
        template,
        choices: { month: "2026-01" },
        aliases: {},
        ...extra,
      });
    const res = expectOk(
      await run({
        accountGroupSigns: { intakter: -1, personal: 1 },
        accountGroupNames: { intakter: "Intäkter", personal: "Personal" },
      }),
    );
    if (res.op !== "apply") throw new Error("apply expected");
    expect(res.result.facts.map((f) => [f.dims.kontogrupp, f.value])).toEqual([
      ["Intäkter", -1000],
      ["Personal", 400],
    ]);
    const without = expectOk(await run({}));
    if (without.op !== "apply") throw new Error("apply expected");
    expect(without.result.facts).toEqual([]);
    expect(without.result.report.issues.map((i) => i.message)).toContain(
      "Kontogruppernas tecken saknas, så budgetbeloppen kan inte vändas rätt.",
    );
  });

  it("returns template errors as messages", async () => {
    const service = new IngestService();
    const bytes = utf8("Startdatum;Slutdatum\n2026-01-01;\n");
    expectOk(await service.handle({ op: "read", fileId: "c", fileName: "lista.csv", bytes }));
    const res = await service.handle({
      op: "apply",
      fileId: "c",
      template: {
        datasetKey: "ip_konsulter",
        name: "Lista",
        headerSignature: ["startdatum", "slutdatum"],
        version: 1,
        config: {
          kind: "cases",
          steps: [],
          columns: [],
          company: { kind: "fixed", company: "MBAB" },
          cases: {
            startColumn: "startdatum",
            resultMap: {},
            groupBy: [],
            metrics: { started: "nyanstallda" },
          },
        },
      },
      choices: {},
      aliases: {},
    });
    expect(res).toEqual({ ok: false, error: "Exportdatum saknas för filen." });
  });
});
