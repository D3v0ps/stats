// Test-only helpers: the synthetic fixture files (fixtures/files), their
// manifest templates and the seeded catalog as a MappingCatalog.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ImportTemplateSchema,
  type FactDraft,
  type ImportTemplate,
  type UploadChoices,
} from "@/lib/contracts";
import { CATALOG_DATASETS, CATALOG_DIMENSIONS, CATALOG_METRICS } from "@/lib/contracts/catalog";
import { normalizeValue } from "@/lib/core/normalize";
import type { AliasTables } from "@/lib/ingest/pipeline";
import type { MappingCatalog } from "./mapping";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface ManifestEntry {
  file: string;
  truth: string;
  datasetKey: string | null;
  kind: "table" | "cases" | "reference";
  choices: UploadChoices;
  aliases: Record<string, Record<string, string>>;
  templates: unknown[];
  sameTruthAs?: string;
  drift?: { fromTemplateOf: string; compatible: boolean };
}

export const MANIFEST = JSON.parse(readFileSync(`${ROOT}fixtures/truth/manifest.json`, "utf8")) as {
  files: ManifestEntry[];
};

export function entry(file: string): ManifestEntry {
  const e = MANIFEST.files.find((f) => f.file === file);
  if (!e) throw new Error(`No manifest entry for ${file}`);
  return e;
}

export function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(`${ROOT}fixtures/files/${file}`));
}

export function sieFixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(`${ROOT}fixtures/sie/${file}`));
}

export function templatesOf(file: string): ImportTemplate[] {
  return entry(file).templates.map((t) => ImportTemplateSchema.parse(t));
}

export function truthOf(file: string): Omit<FactDraft, "sourceRows">[] {
  return JSON.parse(readFileSync(`${ROOT}fixtures/truth/${entry(file).truth}`, "utf8")) as Omit<
    FactDraft,
    "sourceRows"
  >[];
}

/** Manifest aliases ({ kund: { Postnord: "PostNord AB" } }) as lookup tables. */
export function aliasTables(file: string): AliasTables {
  const out: AliasTables = {};
  for (const [dim, map] of Object.entries(entry(file).aliases ?? {})) {
    out[dim] = {};
    for (const [alias, label] of Object.entries(map)) out[dim]![normalizeValue(alias)] = label;
  }
  return out;
}

export const SEED_CATALOG: MappingCatalog = {
  datasets: CATALOG_DATASETS,
  metrics: CATALOG_METRICS,
  dimensions: CATALOG_DIMENSIONS,
};

/** Facts without source rows, in a canonical order, for comparisons. */
export function comparableFacts(facts: readonly Omit<FactDraft, "sourceRows">[]) {
  return facts
    .map((f) => ({
      metricKey: f.metricKey,
      company: f.company,
      month: f.month,
      dims: Object.fromEntries(Object.entries(f.dims).sort(([a], [b]) => (a < b ? -1 : 1))),
      value: f.value,
    }))
    .sort((a, b) => {
      const ka = JSON.stringify(a);
      const kb = JSON.stringify(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}
