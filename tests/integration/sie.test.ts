// Every SIE fixture through the public ingestSie against fixtures/sie/truth: the result per
// month, every account per month and the result per kostnadsställe per month, for the file's
// own year and the previous-year rows it carries. Compared in öre (exact).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IngestResult, LedgerRow } from "@/lib/contracts";
import { ingestSie } from "@/lib/sie";
import { SIE_FIXTURES } from "./manifest";

type ByMonth = Record<string, number>;

interface TruthYear {
  yearOffset: number;
  source: "psaldo" | "trans" | "none";
  resultPerMonth: ByMonth;
  accountMonth: Record<string, ByMonth>;
  costCenterResultPerMonth: Record<string, ByMonth>;
}

interface SieTruth {
  file: string;
  company: "MBAB" | "MBR" | null;
  orgNr: string;
  years: Record<string, TruthYear>;
}

const ore = (x: number) => Math.round(x * 100);
const isResultAccount = (account: number) => account >= 3000 && account <= 8999;

/** key -> month -> öre, summing rows; zero cells dropped so "missing" equals 0. */
function nested(entries: [string, string, number][]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, month, amount] of entries) {
    const byMonth = (out[key] ??= {});
    byMonth[month] = (byMonth[month] ?? 0) + ore(amount);
  }
  for (const [key, byMonth] of Object.entries(out)) {
    for (const [month, v] of Object.entries(byMonth)) if (v === 0) delete byMonth[month];
    if (Object.keys(byMonth).length === 0) delete out[key];
  }
  return out;
}

function truthNested(table: Record<string, ByMonth>): Record<string, Record<string, number>> {
  return nested(
    Object.entries(table).flatMap(([key, byMonth]) =>
      Object.entries(byMonth).map(([month, v]) => [key, month, v] as [string, string, number]),
    ),
  );
}

function monthsOf(byMonth: ByMonth): Record<string, number> {
  return truthNested({ r: byMonth }).r ?? {};
}

const files = readdirSync(SIE_FIXTURES)
  .filter((f) => f.endsWith(".se"))
  .sort();

describe("SIE fixtures through ingestSie equal the truth", () => {
  it("covers every fixture, including the unknown organisation", () => {
    expect(files).toContain("unknown_org.se");
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  describe.each(files)("%s", (file) => {
    const truth = JSON.parse(
      readFileSync(join(SIE_FIXTURES, "truth", file.replace(/\.se$/, ".json")), "utf8"),
    ) as SieTruth;
    let result: IngestResult;
    const ingest = async () =>
      (result ??= await ingestSie(new Uint8Array(readFileSync(join(SIE_FIXTURES, file))), file));
    const rowsOf = (r: IngestResult, yearOffset: number): LedgerRow[] =>
      (r.ledger?.rows ?? []).filter((row) => row.yearOffset === yearOffset);

    it("resolves the company from #ORGNR (unknown -> null, nothing to stage)", async () => {
      const r = await ingest();
      expect(r.ledger?.checks.company ?? null).toBe(truth.company);
      if (truth.company === null) {
        expect(r.companies).toEqual([]);
        expect(r.ledger?.rows).toEqual([]);
        expect(r.slices).toEqual([]);
        expect(r.totals).toEqual([]);
      } else {
        expect(r.companies).toEqual([truth.company]);
        expect(r.ledger?.rows.every((row) => row.company === truth.company)).toBe(true);
      }
    });

    it("reports the result per month of the current year", async () => {
      const r = await ingest();
      const reported = Object.fromEntries(
        (r.ledger?.checks.resultPerMonth ?? []).map((m) => [m.month, ore(m.result)]),
      );
      const expected = monthsOf(truth.years["0"]?.resultPerMonth ?? {});
      for (const [month, v] of Object.entries(expected)) expect(reported[month], month).toBe(v);
      if (truth.company) {
        // Totals cover every slice month, the previous-year rows included.
        const totals = Object.fromEntries(
          r.totals.filter((t) => t.value !== 0).map((t) => [t.month, ore(t.value)]),
        );
        const allYears = Object.assign(
          {},
          ...Object.values(truth.years).map((y) => monthsOf(y.resultPerMonth)),
        ) as Record<string, number>;
        expect(totals).toEqual(allYears);
      }
    });

    for (const [offset, year] of Object.entries(truth.years)) {
      if (truth.company === null) continue;
      const yearOffset = Number(offset);

      it(`year ${offset}: result per month from the ledger rows`, async () => {
        const totals = rowsOf(await ingest(), yearOffset).filter(
          (row) => row.dimNo === null && isResultAccount(row.account),
        );
        const result = nested(totals.map((row) => ["r", row.month, -row.amount]));
        expect(result.r ?? {}).toEqual(monthsOf(year.resultPerMonth));
      });

      it(`year ${offset}: every account per month`, async () => {
        const totals = rowsOf(await ingest(), yearOffset).filter((row) => row.dimNo === null);
        expect(nested(totals.map((row) => [String(row.account), row.month, row.amount]))).toEqual(
          truthNested(year.accountMonth),
        );
      });

      it(`year ${offset}: result per kostnadsställe per month`, async () => {
        const objects = rowsOf(await ingest(), yearOffset).filter(
          (row) => row.dimNo === 1 && isResultAccount(row.account),
        );
        expect(
          nested(objects.map((row) => [row.objectCode ?? "", row.month, -row.amount])),
        ).toEqual(truthNested(year.costCenterResultPerMonth));
      });
    }
  });
});
