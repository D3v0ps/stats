// Reads for the board report editor: the values a slide may filter by. Values of personal
// dimensions (konsult) are never read, so they cannot reach the editor's browser bundle.
import { personalDimensionKeys } from "@/lib/present/context";
import { listDimensions, type DimensionInfo } from "./catalog";
import { fetchAll, type DbClient } from "./shared";

export interface FilterValue {
  id: number;
  label: string;
}

/** Active values per non-personal dimension key, ordered by sort then label. */
export async function listReportFilterValues(
  db: DbClient,
  dimensions?: DimensionInfo[],
): Promise<Record<string, FilterValue[]>> {
  const dims = dimensions ?? (await listDimensions(db));
  const personal = personalDimensionKeys(dims);
  const allowed = dims.filter((d) => !personal.has(d.key));
  if (allowed.length === 0) return {};
  const keyById = new Map(allowed.map((d) => [d.id, d.key]));
  const rows = await fetchAll("dimension_values", (from, to) =>
    db
      .from("dimension_values")
      .select("id, dimension_id, label, sort")
      .in(
        "dimension_id",
        allowed.map((d) => d.id),
      )
      .eq("active", true)
      .order("id")
      .range(from, to),
  );
  const out: Record<string, (FilterValue & { sort: number })[]> = {};
  for (const r of rows) {
    const key = keyById.get(r.dimension_id);
    if (!key) continue;
    (out[key] ??= []).push({ id: r.id, label: r.label, sort: r.sort });
  }
  return Object.fromEntries(
    Object.entries(out).map(([key, values]) => [
      key,
      values
        .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "sv"))
        .map(({ id, label }) => ({ id, label })),
    ]),
  );
}
