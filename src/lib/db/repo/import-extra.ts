// Repo helpers for the upload flow that the core repo does not have: finding a
// file that is already published, and creating a new metric from the mapping view.
import type { MetricKind, Unit } from "@/lib/contracts/domain";
import { unwrap, type DbClient } from "./shared";

export interface PublishedFile {
  uploadId: string;
  datasetKey: string;
  fileSha256: string;
  templateId: string | null;
  templateVersion: number | null;
  publishedAt: string;
}

/** Published uploads of any of the given files (by SHA-256), newest first. */
export async function findPublishedFiles(
  db: DbClient,
  sha256s: string[],
): Promise<PublishedFile[]> {
  const shas = [...new Set(sha256s)];
  if (shas.length === 0) return [];
  const [datasets, uploads] = await Promise.all([
    db.from("datasets").select("id, key"),
    db
      .from("uploads")
      .select("id, dataset_id, file_sha256, template_id, template_version, published_at")
      .in("file_sha256", shas)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .order("id"),
  ]);
  const keyById = new Map(unwrap("datasets", datasets).map((d) => [d.id, d.key]));
  return unwrap("uploads", uploads).map((u) => ({
    uploadId: u.id,
    datasetKey: keyById.get(u.dataset_id) ?? String(u.dataset_id),
    fileSha256: u.file_sha256,
    templateId: u.template_id,
    templateVersion: u.template_version,
    publishedAt: u.published_at ?? "",
  }));
}

/**
 * The published upload a new upload would duplicate: same dataset, same file
 * and same template version (null template for SIE). The database refuses a
 * second publish of exactly that combination.
 */
export function findDuplicate(
  published: readonly PublishedFile[],
  file: {
    datasetKey: string;
    sha256: string;
    templateId: string | null;
    templateVersion: number | null;
  },
): PublishedFile | null {
  return (
    published.find(
      (p) =>
        p.datasetKey === file.datasetKey &&
        p.fileSha256 === file.sha256 &&
        p.templateId === file.templateId &&
        (p.templateVersion ?? 0) === (file.templateVersion ?? 0),
    ) ?? null
  );
}

export interface NewMetricInsert {
  key: string;
  name: string;
  unit: Extract<Unit, "st" | "kr" | "h" | "pct">;
  kind: Extract<MetricKind, "sum" | "snapshot">;
  datasetKey: string;
  higherIsBetter: boolean | null;
  headlineSubject: string;
  description?: string | null;
}

export interface CreatedMetric {
  key: string;
  name: string;
  unit: Unit;
  kind: MetricKind;
  datasetKey: string;
  higherIsBetter: boolean | null;
  decimals: number | null;
}

/** Insert a sum or snapshot metric for a dataset (snapshots roll up by the last month). */
export async function createMetric(db: DbClient, input: NewMetricInsert): Promise<CreatedMetric> {
  const datasets = unwrap("datasets", await db.from("datasets").select("id, key"));
  const dataset = datasets.find((d) => d.key === input.datasetKey);
  if (!dataset) throw new Error(`Okänd datakälla: ${input.datasetKey}`);
  const row = unwrap(
    "metrics.insert",
    await db
      .from("metrics")
      .insert({
        key: input.key,
        name: input.name.trim(),
        unit: input.unit,
        kind: input.kind,
        dataset_id: dataset.id,
        higher_is_better: input.higherIsBetter,
        decimals: input.unit === "pct" ? 1 : 0,
        description: input.description ?? null,
        headline_subject: input.headlineSubject,
        snapshot_rollup: input.kind === "snapshot" ? "last" : null,
      })
      .select("key, name, unit, kind, higher_is_better, decimals")
      .single(),
  );
  return {
    key: row.key,
    name: row.name,
    unit: row.unit as Unit,
    kind: row.kind as MetricKind,
    datasetKey: input.datasetKey,
    higherIsBetter: row.higher_is_better,
    decimals: row.decimals,
  };
}
