// App settings (key -> jsonb) and manual period close.
import { dateToMonth, monthToDate } from "@/lib/core/month";
import { CompanyCodeSchema, type CompanyCode } from "@/lib/contracts/domain";
import type { Json } from "../types";
import { check, unwrap, type DbClient } from "./shared";

export interface AppSettings {
  /** Review flags a month whose change vs the previous month is at least this (percent). */
  deviationThresholdPct: number;
  /** publish_upload rejects uploads parsed by an older ingest engine. */
  minEngineVersion: number;
  /** Every stored setting as-is. */
  raw: Record<string, Json>;
}

/** Defaults the database also falls back to when a setting is missing. */
export const SETTING_DEFAULTS = { deviationThresholdPct: 25, minEngineVersion: 1 } as const;

function numberSetting(raw: Record<string, Json>, key: string, fallback: number): number {
  const v = raw[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function toAppSettings(rows: { key: string; value: Json }[]): AppSettings {
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    deviationThresholdPct: numberSetting(
      raw,
      "deviation_threshold_pct",
      SETTING_DEFAULTS.deviationThresholdPct,
    ),
    minEngineVersion: numberSetting(raw, "min_engine_version", SETTING_DEFAULTS.minEngineVersion),
    raw,
  };
}

export async function getSettings(db: DbClient): Promise<AppSettings> {
  return toAppSettings(
    unwrap("settings", await db.from("settings").select("key, value").order("key")),
  );
}

export async function setSetting(db: DbClient, key: string, value: Json): Promise<void> {
  check("settings.upsert", await db.from("settings").upsert({ key, value }, { onConflict: "key" }));
}

export async function setDeviationThresholdPct(db: DbClient, pct: number): Promise<void> {
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) {
    throw new Error("Avvikelsegränsen måste vara mellan 0 och 1000 %");
  }
  await setSetting(db, "deviation_threshold_pct", pct);
}

// ---- Period close ------------------------------------------------------------

export interface ClosedPeriod {
  company: CompanyCode;
  month: string;
  closedAt: string;
}

async function companyIds(db: DbClient): Promise<Map<string, number>> {
  const rows = unwrap("companies", await db.from("companies").select("id, code"));
  return new Map(rows.map((r) => [r.code, r.id]));
}

export async function listClosedPeriods(db: DbClient): Promise<ClosedPeriod[]> {
  const [ids, rows] = await Promise.all([
    companyIds(db),
    db.from("period_status").select("*").order("month", { ascending: false }).order("company_id"),
  ]);
  const codeById = new Map([...ids].map(([code, id]) => [id, code]));
  return unwrap("period_status", rows).map((r) => ({
    company: CompanyCodeSchema.parse(codeById.get(r.company_id)),
    month: dateToMonth(r.month),
    closedAt: r.closed_at,
  }));
}

export async function closePeriod(
  db: DbClient,
  company: CompanyCode,
  month: string,
): Promise<void> {
  const id = (await companyIds(db)).get(company);
  if (id === undefined) throw new Error(`Okänt bolag: ${company}`);
  check(
    "period_status.upsert",
    await db
      .from("period_status")
      .upsert({ company_id: id, month: monthToDate(month) }, { onConflict: "company_id,month" }),
  );
}

export async function reopenPeriod(
  db: DbClient,
  company: CompanyCode,
  month: string,
): Promise<void> {
  const id = (await companyIds(db)).get(company);
  if (id === undefined) throw new Error(`Okänt bolag: ${company}`);
  check(
    "period_status.delete",
    await db.from("period_status").delete().eq("company_id", id).eq("month", monthToDate(month)),
  );
}
