// Saved dashboards (DashboardSpec JSON). At most one is the default.
import { DashboardSpecSchema, type DashboardSpec } from "@/lib/contracts/dashboard";
import type { Json, Tables } from "../types";
import { check, unwrap, unwrapMaybe, type DbClient } from "./shared";

export interface DashboardRecord {
  id: string;
  name: string;
  isDefault: boolean;
  spec: DashboardSpec;
  updatedAt: string;
}

export function toDashboard(row: Tables<"dashboards">): DashboardRecord {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    spec: DashboardSpecSchema.parse(row.spec),
    updatedAt: row.updated_at,
  };
}

export async function listDashboards(db: DbClient): Promise<DashboardRecord[]> {
  const rows = unwrap(
    "dashboards",
    await db.from("dashboards").select("*").order("is_default", { ascending: false }).order("name"),
  );
  return rows.map(toDashboard);
}

export async function getDashboard(db: DbClient, id: string): Promise<DashboardRecord | null> {
  const row = unwrapMaybe(
    "dashboards",
    await db.from("dashboards").select("*").eq("id", id).maybeSingle(),
  );
  return row ? toDashboard(row) : null;
}

export async function getDefaultDashboard(db: DbClient): Promise<DashboardRecord | null> {
  const row = unwrapMaybe(
    "dashboards",
    await db.from("dashboards").select("*").eq("is_default", true).maybeSingle(),
  );
  return row ? toDashboard(row) : null;
}

export async function createDashboard(
  db: DbClient,
  spec: DashboardSpec,
  opts: { isDefault?: boolean } = {},
): Promise<DashboardRecord> {
  const parsed = DashboardSpecSchema.parse(spec);
  if (opts.isDefault) await clearDefault(db);
  const row = unwrap(
    "dashboards.insert",
    await db
      .from("dashboards")
      .insert({
        name: parsed.name,
        spec: parsed as unknown as Json,
        is_default: opts.isDefault ?? false,
      })
      .select("*")
      .single(),
  );
  return toDashboard(row);
}

export async function updateDashboard(
  db: DbClient,
  id: string,
  spec: DashboardSpec,
): Promise<DashboardRecord> {
  const parsed = DashboardSpecSchema.parse(spec);
  const row = unwrap(
    "dashboards.update",
    await db
      .from("dashboards")
      .update({ name: parsed.name, spec: parsed as unknown as Json })
      .eq("id", id)
      .select("*")
      .single(),
  );
  return toDashboard(row);
}

async function clearDefault(db: DbClient): Promise<void> {
  check(
    "dashboards.update",
    await db.from("dashboards").update({ is_default: false }).eq("is_default", true),
  );
}

/** Make a dashboard the default (the previous default is cleared first). */
export async function setDefaultDashboard(db: DbClient, id: string): Promise<void> {
  await clearDefault(db);
  check("dashboards.update", await db.from("dashboards").update({ is_default: true }).eq("id", id));
}

export async function deleteDashboard(db: DbClient, id: string): Promise<void> {
  check("dashboards.delete", await db.from("dashboards").delete().eq("id", id));
}
