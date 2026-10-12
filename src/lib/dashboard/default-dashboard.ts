// The start dashboard (Översikt) shipped in code. A default dashboard saved in the database
// (getDefaultDashboard) wins; this one is used until then and whenever the saved spec is invalid.
import {
  DashboardSpecSchema,
  type DashboardSpec,
  type WidgetSpec,
} from "@/lib/contracts/dashboard";
import type { z } from "zod";

type WidgetInput = z.input<typeof DashboardSpecSchema>["widgets"][number];

const kpi = (id: string, metricKey: string, x: number, y: number, w: number): WidgetInput => ({
  id,
  viz: "kpi",
  metricKey,
  layout: { x, y, w, h: 1 },
});

/** Widgets shown only when the window has a budget (hidden instead of an empty chart). */
export const BUDGET_ONLY_WIDGET_IDS: ReadonlySet<string> = new Set(["intakter-mot-budget"]);

export const DEFAULT_DASHBOARD: DashboardSpec = DashboardSpecSchema.parse({
  name: "Översikt",
  widgets: [
    // Top KPI row: the money first (wide), then the three volume figures.
    kpi("resultat", "resultat", 0, 0, 6),
    kpi("intakter", "intakter", 6, 0, 6),
    kpi("aktiva-deltagare", "aktiva_deltagare", 0, 1, 4),
    kpi("timmar", "timmar", 4, 1, 4),
    kpi("konsulter", "konsulter", 8, 1, 4),
    // Second row: quality and flow.
    kpi("resultatandel", "resultatandel", 0, 2, 3),
    kpi("faktor", "faktor", 3, 2, 3),
    kpi("sjukfranvaro", "sjukfranvaro", 6, 2, 3),
    kpi("nya-deltagare", "nya_deltagare", 9, 2, 3),
    // Bento grid.
    {
      id: "resultat-per-manad",
      title: "Resultat per månad",
      viz: "line",
      metricKey: "resultat",
      layout: { x: 0, y: 3, w: 8, h: 4 },
    },
    {
      id: "resultat-per-bolag",
      title: "Resultat per bolag",
      viz: "stacked_company",
      metricKey: "resultat",
      layout: { x: 8, y: 3, w: 4, h: 4 },
    },
    {
      id: "deltagare-per-verksamhet",
      title: "Aktiva deltagare per verksamhet",
      viz: "bar",
      metricKey: "aktiva_deltagare",
      groupBy: "verksamhet",
      layout: { x: 0, y: 7, w: 6, h: 4 },
    },
    {
      id: "timmar-per-kund",
      title: "Timmar per kund",
      viz: "toplist",
      metricKey: "timmar",
      groupBy: "kund",
      topN: 8,
      layout: { x: 6, y: 7, w: 6, h: 4 },
    },
    {
      id: "intakter-mot-budget",
      title: "Intäkter mot budget",
      viz: "bar",
      metricKey: "intakter",
      layout: { x: 0, y: 11, w: 12, h: 4 },
    },
  ] satisfies WidgetInput[],
});

/** The saved default dashboard when it parses and has widgets, else the code default. */
export function chooseDashboard(saved: { spec: unknown } | null | undefined): DashboardSpec {
  if (!saved) return DEFAULT_DASHBOARD;
  const parsed = DashboardSpecSchema.safeParse(saved.spec);
  return parsed.success && parsed.data.widgets.length > 0 ? parsed.data : DEFAULT_DASHBOARD;
}

/** Widgets in reading order (row, then column). */
export function orderedWidgets(spec: DashboardSpec): WidgetSpec[] {
  return [...spec.widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
}
