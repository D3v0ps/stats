// Expected numbers come from the fixtures' truth files and are formatted with the app's own
// Swedish formatters, so specs assert what a reader sees ("3 117 h", "−33 tkr").
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";
import { CATALOG_ACCOUNT_GROUPS, CATALOG_METRICS } from "@/lib/contracts/catalog";
import { formatValue } from "@/lib/core/format-sv";

const FIXTURES = path.resolve(__dirname, "..", "..", "fixtures");
const FIXTURE_FILES = path.join(FIXTURES, "files");
const SIE_FILES = path.join(FIXTURES, "sie");

export const fixtureFile = (name: string) => path.join(FIXTURE_FILES, name);
export const sieFile = (name: string) => path.join(SIE_FILES, name);

const FactSchema = z.object({
  metricKey: z.string(),
  company: z.enum(["MBAB", "MBR"]),
  month: z.string(),
  dims: z.record(z.string(), z.string()),
  value: z.number(),
});
export type TruthFact = z.infer<typeof FactSchema>;

const ManifestSchema = z.object({
  files: z.array(
    z.object({
      file: z.string(),
      truth: z.string(),
      counts: z.record(z.string(), z.number()).optional(),
    }),
  ),
});

const SieTruthSchema = z.object({
  company: z.enum(["MBAB", "MBR"]).nullable(),
  years: z.record(
    z.string(),
    z.object({
      resultYtd: z.number(),
      resultPerMonth: z.record(z.string(), z.number()),
      accountMonth: z.record(z.string(), z.record(z.string(), z.number())),
    }),
  ),
});

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

function manifestEntry(file: string) {
  const manifest = ManifestSchema.parse(readJson(path.join(FIXTURES, "truth", "manifest.json")));
  const entry = manifest.files.find((f) => f.file === file);
  if (!entry) throw new Error(`${file} is not in fixtures/truth/manifest.json`);
  return entry;
}

/** The facts a fixture file must produce when mapped as fixtures/README.md describes. */
export function truthFacts(file: string): TruthFact[] {
  const entry = manifestEntry(file);
  return z.array(FactSchema).parse(readJson(path.join(FIXTURES, "truth", entry.truth)));
}

/** Row counts the fixture generator recorded (rows read, filtered out, …). */
export function truthCounts(file: string): Record<string, number> {
  return manifestEntry(file).counts ?? {};
}

export function total(facts: readonly TruthFact[], metricKey: string, month?: string): number {
  return facts
    .filter((f) => f.metricKey === metricKey && (month === undefined || f.month === month))
    .reduce((sum, f) => sum + f.value, 0);
}

/** Distinct values of one dimension among a metric's facts. */
export function distinctValues(facts: readonly TruthFact[], metricKey: string, dim: string) {
  return [...new Set(facts.filter((f) => f.metricKey === metricKey).map((f) => f.dims[dim] ?? ""))];
}

/** Totals of a metric per value of one dimension. */
export function totalsBy(facts: readonly TruthFact[], metricKey: string, dim: string) {
  const totals = new Map<string, number>();
  for (const f of facts) {
    if (f.metricKey !== metricKey) continue;
    const key = f.dims[dim] ?? "";
    totals.set(key, (totals.get(key) ?? 0) + f.value);
  }
  return totals;
}

export function sieTruth(file: string) {
  const name = file.replace(/\.se$/, "");
  return SieTruthSchema.parse(readJson(path.join(SIE_FILES, "truth", `${name}.json`)));
}

/** An account group (intakter, resultat …) for one month of a SIE file, in presentation sign. */
export function ledgerGroupTotal(file: string, groupKey: string, month: string): number {
  const group = CATALOG_ACCOUNT_GROUPS.find((g) => g.key === groupKey);
  const year = Object.values(sieTruth(file).years).find((y) => month in y.resultPerMonth);
  if (!group || !year) throw new Error(`No ${groupKey} for ${month} in ${file}`);
  let sum = 0;
  for (const [account, months] of Object.entries(year.accountMonth)) {
    const n = Number(account);
    if (group.ranges.some((r) => n >= r.from && n <= r.to)) sum += months[month] ?? 0;
  }
  return sum * group.sign;
}

function metric(metricKey: string) {
  const m = CATALOG_METRICS.find((x) => x.key === metricKey);
  if (!m) throw new Error(`Unknown metric ${metricKey}`);
  return m;
}

/** A value as the review's comparison table shows it (the metric's own decimals). */
export function reviewText(metricKey: string, value: number): string {
  const m = metric(metricKey);
  return formatValue(value, m.unit, { decimals: m.decimals ?? undefined });
}

/** A value as a KPI card shows it: amounts compact ("1,5 mkr"), the rest with its decimals. */
export function kpiText(metricKey: string, value: number): string {
  const m = metric(metricKey);
  return formatValue(
    value,
    m.unit,
    m.unit === "kr" ? { compact: true } : { decimals: m.decimals ?? undefined },
  );
}

export function metricName(metricKey: string): string {
  return metric(metricKey).name;
}

/** Every value under a header cell of the first sheet (the header may sit below a title). */
function columnValues(file: string, header: string): string[] {
  const workbook = XLSX.read(readFileSync(fixtureFile(file)));
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) throw new Error(`${file} has no sheet`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const headerRow = rows.findIndex((r) => r.some((c) => String(c).trim() === header));
  const column = rows[headerRow]?.findIndex((c) => String(c).trim() === header) ?? -1;
  if (column < 0) throw new Error(`${file} has no column ${header}`);
  return rows
    .slice(headerRow + 1)
    .map((r) => String(r[column] ?? "").trim())
    .filter((v) => v !== "");
}

/**
 * The people in the fixtures, consultants (Intelliplan) and AF participants (Workbuster), as
 * "Förnamn Efternamn" and as "Efternamn, Förnamn" (the frånvaro export). Names are never
 * stored, so no page may ever show one.
 */
export function fixturePersonNames(): string[] {
  const names = new Set([
    ...columnValues("intelliplan_timmar_MBAB_2026-09.xlsx", "Konsult"),
    ...columnValues("intelliplan_fakturering_MBAB_2026-09.xlsx", "Konsult"),
    ...columnValues("intelliplan_konsulter_MBAB.xlsx", "Namn"),
    ...columnValues("workbuster_deltagare_MBAB.xlsx", "Namn"),
    ...columnValues("workbuster_deltagare_MBR.xlsx", "Namn"),
  ]);
  for (const name of [...names]) {
    const [first, ...last] = name.split(" ");
    if (first && last.length > 0) names.add(`${last.join(" ")}, ${first}`);
  }
  return [...names];
}
