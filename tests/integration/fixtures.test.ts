// Every synthetic fixture file through the app's real ingest (readWorkbook -> runTemplate with
// the manifest's template, choices and aliases) against the independently computed truth.
import { describe, expect, it } from "vitest";
import type { IngestResult, RawWorkbook } from "@/lib/contracts";
import { containsPersonnummer } from "@/lib/core/pnr";
import { diffSignature, headerSignature, loadTable, readWorkbook } from "@/lib/ingest";
// The SIE module's check: every personnummer shape with a real birth date, no Luhn check.
import { containsPersonnummer as looksLikePersonnummer } from "@/lib/sie";
import {
  factKey,
  factMap,
  ingestFixture,
  manifestEntries,
  manifestEntry,
  readFixture,
  readTruth,
  templatesOf,
} from "./manifest";

const TOLERANCE = 1e-6;
const dataFiles = manifestEntries().filter((e) => e.kind !== "reference");

/** Every cell of a workbook as text (display text where the file has one). */
function cellTexts(workbook: RawWorkbook): string[] {
  return workbook.sheets.flatMap((sheet) =>
    sheet.rows.flatMap((row) =>
      row.map((cell) => cell.w ?? (cell.v === null ? "" : String(cell.v))),
    ),
  );
}

/** Every string anywhere in a value (object keys included). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

describe("fixtures through runTemplate equal the truth", () => {
  it("covers every data file of the manifest", () => {
    expect(dataFiles.length).toBeGreaterThanOrEqual(12);
    for (const e of dataFiles) expect(e.templates.length, e.file).toBeGreaterThan(0);
  });

  describe.each(dataFiles.map((e) => [e.file, e] as const))("%s", (_file, entry) => {
    let results: IngestResult[];
    const ingest = async () => (results ??= await ingestFixture(entry));

    it("produces exactly the truth's facts (same keys, values to 1e-6)", async () => {
      const facts = (await ingest()).flatMap((r) => r.facts);
      const truthFacts = readTruth(entry);
      expect(truthFacts.filter((f) => f.value === 0)).toEqual([]);
      // Only the cases ingest writes zeros (a month with nobody active); table files must
      // produce exactly the truth's keys.
      const dropZeros = entry.kind === "cases";
      const app = factMap(facts, { dropZeros });
      const truth = factMap(truthFacts, { dropZeros });
      expect(truth.size).toBeGreaterThan(0);

      const missing = [...truth.keys()].filter((k) => !app.has(k));
      const extra = [...app.keys()].filter((k) => !truth.has(k));
      expect(missing, "facts in the truth but not from the app").toEqual([]);
      expect(extra, "facts from the app but not in the truth").toEqual([]);
      const off = [...truth].filter(([k, v]) => Math.abs((app.get(k) ?? 0) - v) > TOLERANCE);
      expect(
        off.map(([k, v]) => ({ key: k, truth: v, app: app.get(k) })),
        "values that differ",
      ).toEqual([]);
    });

    it("keeps the dataset, scenario, companies and months of the truth", async () => {
      const rs = await ingest();
      for (const r of rs) {
        expect(r.datasetKey).toBe(entry.datasetKey);
        expect(r.scenario).toBe(entry.scenario);
      }
      const truth = readTruth(entry);
      const companies = [...new Set(rs.flatMap((r) => r.companies))].sort();
      expect(companies).toEqual([...new Set(truth.map((f) => f.company))].sort());
      const months = new Set(rs.flatMap((r) => r.slices.map((s) => s.month)));
      for (const m of entry.months) expect(months.has(m), m).toBe(true);
      // Every fact has a unique key within one result (the staging contract).
      for (const r of rs) expect(new Set(r.facts.map(factKey)).size).toBe(r.facts.length);
    });

    it("never lets a personnummer into a fact or the parse report", async () => {
      for (const r of await ingest()) {
        const texts = [
          ...strings(r.facts.map((f) => ({ metricKey: f.metricKey, dims: f.dims }))),
          ...strings(r.report),
          ...strings(r.totals),
          r.file.name,
        ];
        expect(texts.filter((t) => containsPersonnummer(t))).toEqual([]);
        // Not even a personnummer-shaped number with a wrong check digit gets through.
        expect(texts.filter((t) => looksLikePersonnummer(t))).toEqual([]);
        expect(r.report.issues.filter((i) => i.severity === "error")).toEqual([]);
      }
    });
  });

  it("reads files that do hold personnummer, so the check above is not vacuous", () => {
    const withPnr = dataFiles
      .filter((e) =>
        cellTexts(readWorkbook(readFixture(e.file), e.file)).some((t) => containsPersonnummer(t)),
      )
      .map((e) => e.datasetKey);
    expect(new Set(withPnr)).toEqual(new Set(["ip_timmar", "ip_konsulter", "wb_deltagare"]));
  });
});

describe("the drifted export", () => {
  const drifted = dataFiles.filter((e) => e.drift);

  it("exists in the manifest", () => {
    expect(drifted.length).toBeGreaterThan(0);
  });

  it.each(drifted.map((e) => [e.file, e] as const))(
    "%s gives an incompatible signature diff against the base template",
    (_file, entry) => {
      const drift = entry.drift!;
      const base = templatesOf(manifestEntry(drift.fromTemplateOf))[0]!;
      const workbook = readWorkbook(readFixture(entry.file), entry.file);
      const { table } = loadTable(workbook, {
        sheetHint: base.sheetHint,
        expectedHeaders: base.headerSignature,
      });
      const diff = diffSignature(base.headerSignature, headerSignature(table));
      expect(diff.compatible).toBe(false);
      expect(drift.compatible).toBe(false);
      // A similarity detector may report a rename as removed + added; both are accepted.
      const added = [...diff.added, ...diff.renamed.map((r) => r.to)];
      const removed = [...diff.removed, ...diff.renamed.map((r) => r.from)];
      for (const header of drift.added) expect(added).toContain(header);
      for (const header of drift.removed) expect(removed).toContain(header);
    },
  );

  it.each(drifted.map((e) => [e.file, e] as const))(
    "%s still matches the base template's own file",
    (_file, entry) => {
      const base = templatesOf(manifestEntry(entry.drift!.fromTemplateOf))[0]!;
      const own = manifestEntry(entry.drift!.fromTemplateOf);
      const workbook = readWorkbook(readFixture(own.file), own.file);
      const { table } = loadTable(workbook, {
        sheetHint: base.sheetHint,
        expectedHeaders: base.headerSignature,
      });
      expect(diffSignature(base.headerSignature, headerSignature(table)).compatible).toBe(true);
    },
  );
});
