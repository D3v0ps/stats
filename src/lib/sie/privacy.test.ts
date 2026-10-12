// Personal data never leaves ingestSie: no personnummer in any returned string
// and no objects of personal dimensions (SIE 7 "Anställd", "Konsult", ...).
import { describe, expect, it } from "vitest";
import type { IngestResult } from "@/lib/contracts";
import { encodeCp437 } from "@/lib/core/cp437";
import { ingestSie } from "./index";
import { containsPersonnummer } from "./pii";

const HEADER = [
  "#FLAGGA 0",
  "#FORMAT PC8",
  "#SIETYP 4",
  '#GEN 20261005 "Test"',
  '#FNAMN "Miljonbemanning AB"',
  "#ORGNR 556959-9318",
  "#RAR 0 20260101 20261231",
  '#KONTO 3041 "Försäljning"',
  '#KONTO 7010 "Löner"',
  '#DIM 1 "Kostnadsställe"',
  '#OBJEKT 1 "100" "Bemanning"',
];

async function ingest(lines: string[], objectDims?: number[]): Promise<IngestResult> {
  const bytes = encodeCp437(lines.join("\r\n"));
  return ingestSie(bytes, "test.se", objectDims ? { objectDims } : {});
}

/** Every string ingest returns, except the hashes (random hex may contain digit runs). */
function returnedText(r: IngestResult): string {
  return JSON.stringify({ ...r, file: { ...r.file, sha256: "" }, contentHash: "" });
}

describe("personnummer never leave ingestSie", () => {
  it("drops an #ORGNR that is a personnummer (sole trader file)", async () => {
    const r = await ingest([
      ...HEADER.filter((l) => !l.startsWith("#ORGNR") && !l.startsWith("#FNAMN")),
      '#FNAMN "Anna Andersson 850101-1234"',
      "#ORGNR 850101-1234",
      "#RES 0 3041 -100.00",
      "#PSALDO 0 202601 3041 {} -100.00",
    ]);
    const checks = r.ledger?.checks;
    expect(checks?.company).toBeNull();
    expect(checks?.orgNr).toBeNull();
    expect(checks?.warnings).toContain(
      "#ORGNR ser ut som ett personnummer och har tagits bort. Filen hör inte till något av bolagen och kan inte publiceras.",
    );
    expect(r.ledger?.rows).toEqual([]);
    expect(containsPersonnummer(returnedText(r))).toBe(false);
  });

  it("drops a 12-digit personnummer in #ORGNR as well", async () => {
    const r = await ingest([
      ...HEADER.filter((l) => !l.startsWith("#ORGNR")),
      "#ORGNR 198501011234",
      "#PSALDO 0 202601 3041 {} -100.00",
    ]);
    expect(r.ledger?.checks.orgNr).toBeNull();
    expect(containsPersonnummer(returnedText(r))).toBe(false);
  });

  it("masks personnummer in parse issues", async () => {
    const r = await ingest([
      ...HEADER,
      "#RES 0 3041 -100.00",
      "#PSALDO 0 202601 3041 {} -100.00",
      'Anna Andersson 19850101-1234 "lön"',
      "#RES 0 8501011234 5.00",
    ]);
    expect(r.report.issues.map((i) => i.value)).toEqual([
      'Anna Andersson ÅÅMMDD-XXXX "lön"',
      "ÅÅMMDD-XXXX",
    ]);
    expect(containsPersonnummer(returnedText(r))).toBe(false);
  });

  it("masks a personnummer in the file name", async () => {
    const bytes = encodeCp437([...HEADER, "#PSALDO 0 202601 3041 {} -100.00"].join("\r\n"));
    const r = await ingestSie(bytes, "SIE Anna 850101-1234.se");
    expect(r.file.name).toBe("SIE Anna ÅÅMMDD-XXXX.se");
  });

  it("masks personnummer quoted in warnings", async () => {
    const r = await ingest([
      ...HEADER.filter((l) => !l.startsWith("#FORMAT")),
      '#FORMAT "850101-1234"',
      "#RES 0 3041 -100.00",
      "#PSALDO 0 202601 3041 {} -100.00",
    ]);
    expect(r.ledger?.checks.warnings[0]).toMatch(/^Okänt #FORMAT "ÅÅMMDD-XXXX"/);
    expect(containsPersonnummer(returnedText(r))).toBe(false);
  });

  it("keeps objects whose code is a personnummer out of rows and objects", async () => {
    const r = await ingest([
      ...HEADER,
      '#OBJEKT 1 "850101-1234" "Anna Andersson"',
      "#RES 0 7010 300.00",
      "#PSALDO 0 202601 7010 {} 300.00",
      '#PSALDO 0 202601 7010 {1 "100"} 100.00',
      '#PSALDO 0 202601 7010 {1 "850101-1234"} 200.00',
    ]);
    const rows = r.ledger?.rows ?? [];
    expect(rows.map((x) => [x.dimNo, x.objectCode, x.amount])).toEqual([
      [null, null, 300],
      [1, "100", 100],
    ]);
    expect(r.ledger?.objects.map((o) => o.code)).toEqual(["100"]);
    expect(r.ledger?.checks.warnings).toContain(
      "1 objekt med personnummer som kod togs inte med; beloppen räknas som ofördelade.",
    );
    expect(containsPersonnummer(returnedText(r))).toBe(false);
  });

  it("does the same for voucher rows in the #TRANS fallback", async () => {
    const r = await ingest([
      ...HEADER,
      "#RES 0 7010 300.00",
      '#VER A 1 20260125 "Lön"',
      "{",
      '#TRANS 7010 {1 "100"} 100.00',
      '#TRANS 7010 {1 "8501011234"} 200.00',
      "#TRANS 1930 {} -300.00",
      "}",
    ]);
    expect(r.ledger?.rows.map((x) => [x.dimNo, x.objectCode, x.amount])).toEqual([
      [null, null, 300],
      [1, "100", 100],
    ]);
    expect(containsPersonnummer(returnedText(r))).toBe(false);
  });

  it("masks personnummer in account and object names", async () => {
    const r = await ingest([
      ...HEADER.filter((l) => !l.startsWith("#OBJEKT")),
      '#KONTO 7210 "Lön 850101-1234"',
      '#OBJEKT 1 "100" "Bemanning (ansvarig 850101-1234)"',
      "#RES 0 3041 -100.00",
      "#PSALDO 0 202601 3041 {} -100.00",
    ]);
    expect(r.ledger?.accounts.find((a) => a.account === 7210)?.name).toBe("Lön ÅÅMMDD-XXXX");
    expect(r.ledger?.objects).toEqual([
      { company: "MBAB", dimNo: 1, code: "100", name: "Bemanning (ansvarig ÅÅMMDD-XXXX)" },
    ]);
    expect(containsPersonnummer(returnedText(r))).toBe(false);
  });
});

describe("personal dimensions never become object rows", () => {
  const lines = [
    ...HEADER,
    '#DIM 7 "Anställd"',
    '#DIM 20 "Konsult"',
    '#OBJEKT 7 "17" "Anna Andersson"',
    '#OBJEKT 20 "K1" "Bertil Berg"',
    "#RES 0 7010 300.00",
    "#PSALDO 0 202601 7010 {} 300.00",
    '#PSALDO 0 202601 7010 {1 "100"} 300.00',
    '#PSALDO 0 202601 7010 {7 "17"} 120.00',
    '#PSALDO 0 202601 7010 {20 "K1"} 80.00',
  ];

  it("ignores SIE dimension 7 and person-named dimensions even when requested", async () => {
    const r = await ingest(lines, [1, 7, 20]);
    expect(r.ledger?.rows.map((x) => [x.dimNo, x.objectCode])).toEqual([
      [null, null],
      [1, "100"],
    ]);
    expect(r.ledger?.objects.map((o) => [o.dimNo, o.code])).toEqual([[1, "100"]]);
    expect(JSON.stringify(r)).not.toMatch(/Anna Andersson|Bertil Berg/);
    expect(r.ledger?.checks.warnings).toContain(
      "Dimensionerna 7 (Anställd) och 20 (Konsult) innehåller personer och togs inte med.",
    );
  });

  it("stays silent when no personal dimension is requested", async () => {
    const r = await ingest(lines);
    expect(r.ledger?.checks.warnings.some((w) => w.includes("innehåller personer"))).toBe(false);
  });
});
