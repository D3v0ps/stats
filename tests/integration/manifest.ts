// The synthetic fixtures (fixtures/files + fixtures/truth/manifest.json) run through the app's
// own ingest. Shared by the integration tests and the database round trip
// (supabase/tests/db-roundtrip.test.ts). Test-only helpers, not a test file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FactDraftSchema,
  ImportTemplateSchema,
  type CompanyCode,
  type FactDraft,
  type ImportTemplate,
  type IngestResult,
  type UploadChoices,
} from "@/lib/contracts";
import { CATALOG_ACCOUNT_GROUPS } from "@/lib/contracts/catalog";
import { sha256Hex } from "@/lib/core/hash";
import { normalizeValue } from "@/lib/core/normalize";
import { readWorkbook, runTemplate, type RunContext } from "@/lib/ingest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const FIXTURE_FILES = join(ROOT, "fixtures/files");
export const FIXTURE_TRUTH = join(ROOT, "fixtures/truth");
export const SIE_FIXTURES = join(ROOT, "fixtures/sie");

export interface ManifestEntry {
  file: string;
  truth: string;
  datasetKey: string | null;
  kind: "table" | "cases" | "reference";
  companies: CompanyCode[];
  scenario: "utfall" | "budget";
  months: string[];
  choices: UploadChoices;
  aliases: Record<string, Record<string, string>>;
  templates: unknown[];
  sameTruthAs?: string;
  drift?: { fromTemplateOf: string; added: string[]; removed: string[]; compatible: boolean };
}

const TruthFactSchema = FactDraftSchema.omit({ sourceRows: true }).strict();
export type TruthFact = Omit<FactDraft, "sourceRows">;

export function manifestEntries(): ManifestEntry[] {
  const manifest = JSON.parse(readFileSync(join(FIXTURE_TRUTH, "manifest.json"), "utf8")) as {
    files: ManifestEntry[];
  };
  return manifest.files;
}

export function manifestEntry(file: string): ManifestEntry {
  const found = manifestEntries().find((e) => e.file === file);
  if (!found) throw new Error(`No manifest entry for ${file}`);
  return found;
}

export function readTruth(entry: ManifestEntry): TruthFact[] {
  const raw = JSON.parse(readFileSync(join(FIXTURE_TRUTH, entry.truth), "utf8")) as unknown[];
  return raw.map((f) => TruthFactSchema.parse(f));
}

export function templatesOf(entry: ManifestEntry): ImportTemplate[] {
  return entry.templates.map((t) => ImportTemplateSchema.parse(t));
}

/** The manifest's aliases as the pipeline's alias tables (normalized alias -> label). */
export function aliasTables(entry: ManifestEntry): RunContext["aliases"] {
  return Object.fromEntries(
    Object.entries(entry.aliases).map(([dim, table]) => [
      dim,
      Object.fromEntries(Object.entries(table).map(([raw, label]) => [normalizeValue(raw), label])),
    ]),
  );
}

export const ACCOUNT_GROUP_SIGNS: Record<string, 1 | -1> = Object.fromEntries(
  CATALOG_ACCOUNT_GROUPS.map((g) => [g.key, g.sign]),
);
export const ACCOUNT_GROUP_NAMES: Record<string, string> = Object.fromEntries(
  CATALOG_ACCOUNT_GROUPS.map((g) => [g.key, g.name]),
);

export function readFixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURE_FILES, file)));
}

/** Every template of the entry run on its file with the manifest's choices (one result each). */
export async function ingestFixture(entry: ManifestEntry): Promise<IngestResult[]> {
  const bytes = readFixture(entry.file);
  const workbook = readWorkbook(bytes, entry.file);
  const ctx: RunContext = {
    aliases: aliasTables(entry),
    fileSha256: await sha256Hex(bytes),
    fileSize: bytes.byteLength,
    accountGroupSigns: ACCOUNT_GROUP_SIGNS,
    accountGroupNames: ACCOUNT_GROUP_NAMES,
  };
  return Promise.all(
    templatesOf(entry).map((template) => runTemplate(workbook, template, entry.choices, ctx)),
  );
}

export function factKey(f: Pick<FactDraft, "metricKey" | "company" | "month" | "dims">): string {
  const dims = Object.entries(f.dims).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([f.metricKey, f.company, f.month, dims]);
}

/**
 * Facts keyed by (metric, company, month, dims). With `dropZeros`, value-0 facts are left
 * out: the truth omits them while the cases ingest writes explicit zeros (a count of nobody),
 * and a missing key means 0 for both. Table ingest never writes zeros the truth lacks, so it
 * is compared with every fact kept.
 */
export function factMap(
  facts: readonly TruthFact[],
  { dropZeros }: { dropZeros: boolean },
): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of facts) {
    if (dropZeros && f.value === 0) continue;
    const key = factKey(f);
    if (out.has(key)) throw new Error(`Duplicate fact ${key}`);
    out.set(key, f.value);
  }
  return out;
}
