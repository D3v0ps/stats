// The standard board report: one message per slide, the numbers the board asks about
// every month. Created from /rapporter ("Skapa standardrapport") and editable afterwards.
// Never groups or filters by a personal dimension (konsult).
import type { z } from "zod";
import {
  ReportTemplateSpecSchema,
  type ReportTemplateSpec,
  type SlideSpecSchema,
} from "@/lib/contracts/slides";

export const DEFAULT_REPORT_NAME = "Styrelserapport";

type SlideInput = z.input<typeof SlideSpecSchema>;

const DEFAULT_SLIDES: SlideInput[] = [
  {
    id: "resultat-per-bolag",
    viz: "stacked_company",
    metricKey: "resultat",
    grain: "month",
    company: "ALL",
    compare: "prev_period",
    notes:
      "Resultat per månad de senaste tolv månaderna, staplat per bolag. Summa bolag är inte eliminerat.",
  },
  {
    id: "resultat-ytd-budget",
    viz: "kpi",
    metricKey: "resultat",
    grain: "ytd",
    company: "ALL",
    compare: "budget",
    notes: "Resultat hittills i år mot budget för samma månader.",
  },
  {
    id: "intakter-per-manad",
    viz: "line",
    metricKey: "intakter",
    grain: "month",
    company: "ALL",
    compare: "prev_year",
    notes: "Intäkter per månad. Den streckade linjen är samma månader i fjol.",
  },
  {
    id: "aktiva-deltagare",
    viz: "kpi",
    metricKey: "aktiva_deltagare",
    grain: "month",
    company: "ALL",
    compare: "prev_period",
    notes: "Aktiva deltagare i AF-programmen vid månadens slut.",
  },
  {
    id: "deltagare-per-verksamhet",
    viz: "bar",
    metricKey: "aktiva_deltagare",
    grain: "month",
    company: "ALL",
    groupBy: "verksamhet",
    compare: "prev_period",
    notes: "Aktiva deltagare per verksamhet jämfört med föregående månad.",
  },
  {
    id: "andel-arbete-studier",
    viz: "kpi",
    metricKey: "resultatandel",
    grain: "ytd",
    company: "ALL",
    compare: "prev_year",
    notes: "Andel av de avslutade deltagarna som gått till arbete eller studier hittills i år.",
  },
  {
    id: "fakturerade-timmar",
    viz: "kpi",
    metricKey: "timmar",
    grain: "month",
    company: "ALL",
    compare: "prev_period",
    notes: "Attesterade och exporterade timmar i bemanningen.",
  },
  {
    id: "timmar-per-kund",
    viz: "toplist",
    metricKey: "timmar",
    grain: "month",
    company: "ALL",
    groupBy: "kund",
    compare: "prev_period",
    topN: 8,
    notes: "De största kunderna räknat i fakturerade timmar.",
  },
  {
    id: "konsulter-i-arbete",
    viz: "kpi",
    metricKey: "konsulter",
    grain: "month",
    company: "ALL",
    compare: "prev_period",
    notes: "Unika konsulter med timmar under månaden.",
  },
];

/** The default report template, validated with the shared schema. */
export function defaultReportSpec(name: string = DEFAULT_REPORT_NAME): ReportTemplateSpec {
  return ReportTemplateSpecSchema.parse({ name, slides: DEFAULT_SLIDES });
}
