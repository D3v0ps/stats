import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  UploadCreateSchema,
  LedgerRowSchema,
  type IngestResult,
} from "@/lib/contracts";
import { decodeCp437, encodeCp437 } from "@/lib/core/cp437";
import { monthRange } from "@/lib/core/month";
import { canonicalLedger, ingestSie } from "./index";
import { sha256Hex } from "./sha256";
import { readSieFixture, readSieTruth, SIE_FIXTURES } from "./test-fixtures";

const ore = (kr: number) => Math.round(kr * 100);

const results = new Map<string, IngestResult>();
async function ingest(name: string, objectDims?: number[]): Promise<IngestResult> {
  const key = `${name}|${objectDims?.join(",") ?? ""}`;
  const cached = results.get(key);
  if (cached) return cached;
  const result = await ingestSie(readSieFixture(name), name, objectDims ? { objectDims } : {});
  results.set(key, result);
  return result;
}

describe("sha256Hex", () => {
  it("matches node:crypto for bytes and strings", async () => {
    const bytes = readSieFixture("mbab_2026_psaldo.se");
    expect(await sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await sha256Hex("åäö")).toBe(createHash("sha256").update("åäö", "utf8").digest("hex"));
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe.each(SIE_FIXTURES)("ingestSie(%s)", (name) => {
  const truth = readSieTruth(name);

  it("describes the upload", async () => {
    const r = await ingest(name);
    const bytes = readSieFixture(name);
    expect(r.engineVersion).toBe(ENGINE_VERSION);
    expect(r.datasetKey).toBe("fx_bokforing");
    expect(r.scenario).toBe("utfall");
    expect(r.facts).toEqual([]);
    expect(r.file).toEqual({
      name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    });
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.asOfDate).toBe("2026-10-05");
    expect(r.report.encoding).toBe(truth.encoding);
    expect(r.report.issues).toEqual([]);
    expect(r.report.rowsRead).toBeGreaterThan(0);
    expect(r.report.rowsUsed).toBe(r.report.rowsRead);
    expect(r.report.warnings).toEqual(r.ledger?.checks.warnings);
  });

  it("returns valid ledger rows, slices and upload header data", async () => {
    const r = await ingest(name);
    for (const row of r.ledger?.rows ?? [])
      expect(LedgerRowSchema.safeParse(row).success).toBe(true);
    if (!truth.company) return;
    const header = UploadCreateSchema.safeParse({
      datasetKey: r.datasetKey,
      templateId: null,
      templateVersion: null,
      scenario: r.scenario,
      fileName: r.file.name,
      fileSha256: r.file.sha256,
      fileSize: r.file.size,
      contentHash: r.contentHash,
      engineVersion: r.engineVersion,
      asOfDate: r.asOfDate ?? null,
      slices: r.slices,
      parseReport: r.report,
      totals: r.totals,
    });
    expect(header.success).toBe(true);
  });

  it("covers each month with data as a slice, previous year at priority -1", async () => {
    const r = await ingest(name);
    if (!truth.company) {
      expect(r.companies).toEqual([]);
      expect(r.slices).toEqual([]);
      return;
    }
    expect(r.companies).toEqual([truth.company]);
    const expected = Object.values(truth.years)
      .flatMap((y) =>
        Object.keys(y.resultPerMonth).map((month) => ({
          company: truth.company,
          month,
          priority: y.yearOffset === 0 ? 0 : -1,
        })),
      )
      .sort((a, b) => (a.month < b.month ? -1 : 1));
    expect(r.slices).toEqual(expected);
  });

  it("reports the monthly result as totals for every slice month", async () => {
    const r = await ingest(name);
    if (!truth.company) {
      expect(r.totals).toEqual([]);
      return;
    }
    const expected = Object.values(truth.years)
      .flatMap((y) => Object.entries(y.resultPerMonth))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, value]) => [month, ore(value)]);
    expect(r.totals.map((t) => [t.month, ore(t.value)])).toEqual(expected);
    expect(r.totals.every((t) => t.metricKey === "resultat" && t.company === truth.company)).toBe(
      true,
    );
  });

  it("lists result accounts and kostnadsställen", async () => {
    const r = await ingest(name);
    if (!truth.company) {
      expect(r.ledger?.accounts).toEqual([]);
      expect(r.ledger?.objects).toEqual([]);
      return;
    }
    expect(r.ledger?.accounts).toEqual(
      Object.entries(truth.accounts)
        .filter(([a]) => Number(a) >= 3000 && Number(a) <= 8999)
        .map(([account, accountName]) => ({
          company: truth.company,
          account: Number(account),
          name: accountName,
        })),
    );
    expect(r.ledger?.objects).toEqual(
      Object.entries(truth.objects["1"] ?? {})
        .map(([code, objectName]) => ({ company: truth.company, dimNo: 1, code, name: objectName }))
        .sort((a, b) => (a.code < b.code ? -1 : 1)),
    );
  });
});

describe("ingestSie specifics", () => {
  it("keeps previous-year rows flagged yearOffset -1 with priority -1 slices", async () => {
    const r = await ingest("mbab_2026_psaldo.se");
    const prev = r.ledger?.rows.filter((x) => x.yearOffset === -1) ?? [];
    expect(prev.length).toBeGreaterThan(0);
    expect(prev.every((x) => x.month.startsWith("2025-"))).toBe(true);
    expect(r.slices.filter((s) => s.priority === -1).map((s) => s.month)).toEqual(
      monthRange("2025-01", "2025-12"),
    );
    expect(r.slices.filter((s) => s.priority === 0).map((s) => s.month)).toEqual(
      monthRange("2026-01", "2026-09"),
    );
  });

  it("returns the parse but no rows for an unknown org number", async () => {
    const r = await ingest("unknown_org.se");
    const truth = readSieTruth("unknown_org.se");
    expect(r.ledger?.checks.company).toBeNull();
    expect(r.ledger?.checks.orgNr).toBe("556677-8899");
    expect(r.ledger?.checks.companyName).toBe("Exempelbolaget i Söderort AB");
    expect(r.ledger?.checks.warnings[0]).toMatch(/556677-8899 hör inte till något av bolagen/);
    expect(r.ledger?.rows).toEqual([]);
    expect(r.ledger?.checks.resultPerMonth.map((m) => [m.month, ore(m.result)])).toEqual(
      Object.entries(truth.years["0"]?.resultPerMonth ?? {}).map(([m, v]) => [m, ore(v)]),
    );
    expect(r.contentHash).toBe(await sha256Hex("[]"));
  });

  it("adds project objects when dimension 6 is requested", async () => {
    const r = await ingest("mbab_2026_psaldo.se", [1, 6]);
    expect(r.ledger?.objects.filter((o) => o.dimNo === 6)).toEqual([
      { company: "MBAB", dimNo: 6, code: "P1", name: "Projekt Älvsjö" },
      { company: "MBAB", dimNo: 6, code: "P2", name: "Projekt Örebro" },
    ]);
    expect(r.ledger?.rows.some((x) => x.dimNo === 6)).toBe(true);
    expect(r.contentHash).not.toBe((await ingest("mbab_2026_psaldo.se")).contentHash);
  });

  it("gives equal content hashes for equal ledgers and different ones otherwise", async () => {
    const movement = await ingest("mbab_2026_psaldo.se");
    const cumulative = await ingest("mbab_2026_cumulative.se");
    expect(cumulative.file.sha256).not.toBe(movement.file.sha256);
    expect(cumulative.contentHash).toBe(movement.contentHash);

    const text = decodeCp437(readSieFixture("mbab_2026_psaldo.se"));
    const changed = text.replace(
      /^(#PSALDO 0 202603 5010 \{\} )(\S+)$/m,
      (_, head: string, v: string) => `${head}${(Number(v) + 0.01).toFixed(2)}`,
    );
    expect(changed).not.toBe(text);
    const r = await ingestSie(encodeCp437(changed), "changed.se");
    expect(r.contentHash).not.toBe(movement.contentHash);
  });

  it("serializes the ledger independently of row order and float formatting", () => {
    const rows = [
      {
        company: "MBAB" as const,
        month: "2026-02",
        account: 3041,
        dimNo: null,
        objectCode: null,
        amount: -0.3,
        yearOffset: 0,
        source: "psaldo" as const,
      },
      {
        company: "MBAB" as const,
        month: "2026-01",
        account: 3041,
        dimNo: 1,
        objectCode: "100",
        amount: 0.1 + 0.2,
        yearOffset: 0,
        source: "psaldo" as const,
      },
    ];
    expect(canonicalLedger(rows)).toBe(canonicalLedger([...rows].reverse()));
    expect(canonicalLedger([{ ...rows[1]!, amount: 0.3 }, rows[0]!])).toBe(canonicalLedger(rows));
  });

  it("names undeclared objects by their code", async () => {
    const text = [
      "#FORMAT PC8",
      "#SIETYP 4",
      "#ORGNR 556959-9318",
      "#RAR 0 20260101 20261231",
      '#KONTO 3041 "Försäljning"',
      '#OBJEKT 1 "100" "Bemanning"',
      "#RES 0 3041 -15.00",
      "#PSALDO 0 202601 3041 {} -15.00",
      '#PSALDO 0 202601 3041 {1 "100"} -10.00',
      '#PSALDO 0 202601 3041 {1 "999"} -5.00',
    ].join("\r\n");
    const r = await ingestSie(encodeCp437(text), "x.se");
    expect(r.ledger?.objects).toEqual([
      { company: "MBAB", dimNo: 1, code: "100", name: "Bemanning" },
      { company: "MBAB", dimNo: 1, code: "999", name: "999" },
    ]);
    expect(r.ledger?.checks.warnings).toContain("Objektnamn saknas (#OBJEKT) för: 1:999.");
    expect(r.totals).toEqual([
      { metricKey: "resultat", company: "MBAB", month: "2026-01", value: 15 },
    ]);
  });

  it("counts unknown and malformed lines in the parse report", async () => {
    const text = [
      "#FORMAT PC8",
      "#SIETYP 4",
      "#ORGNR 556959-9318",
      "#RAR 0 20260101 20261231",
      "#FOO 1",
      "#RES 0 3041 x",
      "#PSALDO 0 202601 3041 {} -15.00",
    ].join("\r\n");
    const r = await ingestSie(encodeCp437(text), "x.se");
    expect(r.report.rowsRead).toBe(7);
    expect(r.report.rowsUsed).toBe(5);
    expect(r.report.issues).toEqual([
      { sourceRow: 6, column: "#RES", value: "x", message: "Ogiltigt belopp", severity: "warning" },
    ]);
  });
});
