// Ready-made Utforska views: several metrics side by side for one breakdown, e.g. per kund:
// konsulter, timmar, fakturerat, faktor, sjukpass per konsult.
import type { MetricDefinition } from "@/lib/contracts/metric-query";

export interface ExplorePreset {
  id: string;
  label: string;
  metrics: string[];
  groupBy: string;
}

export const EXPLORE_PRESETS: readonly ExplorePreset[] = [
  {
    id: "bemanning-kund",
    label: "Bemanning per kund",
    metrics: ["konsulter", "timmar", "fakturerat_ip", "faktor", "sjukpass_per_konsult"],
    groupBy: "kund",
  },
  {
    id: "af-verksamhet",
    label: "AF-program per verksamhet",
    metrics: ["aktiva_deltagare", "nya_deltagare", "resultatandel", "avbrott_deltagare"],
    groupBy: "verksamhet",
  },
  {
    id: "ekonomi-bolag",
    label: "Resultaträkning per bolag",
    metrics: ["intakter", "kostnader", "resultat", "resultatmarginal"],
    groupBy: "bolag",
  },
  {
    id: "fakturerat-bokfort",
    label: "Fakturerat per kund mot bokfört",
    metrics: ["fakturerat_kund"],
    groupBy: "kund",
  },
];

/** Presets restricted to metrics that exist; presets left without metrics are dropped. */
export function availablePresets(defs: readonly MetricDefinition[]): ExplorePreset[] {
  const keys = new Set(defs.map((d) => d.key));
  return EXPLORE_PRESETS.map((p) => ({
    ...p,
    metrics: p.metrics.filter((k) => keys.has(k)),
  })).filter((p) => p.metrics.length > 0);
}
