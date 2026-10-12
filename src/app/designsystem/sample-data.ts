// Invented numbers for the /designsystem page (visual checks only; never real data).
import type { ChartData } from "@/lib/contracts";
import { addMonths, formatMonthShort, monthRange } from "@/lib/core/month";

const ANCHOR = "2026-09";
const months = monthRange(addMonths(ANCHOR, -11), ANCHOR);
const monthLabels = months.map((m) => formatMonthShort(m).split(" ")[0]!);

export const hoursTrend = [
  4120,
  4380,
  3950,
  4410,
  4630,
  4870,
  4520,
  null,
  5010,
  4890,
  5230,
  5480,
] as const;

export const lineChart: ChartData = {
  categories: monthLabels,
  series: [
    { key: "current", label: "Senaste 12 mån", role: "primary", values: [...hoursTrend] },
    {
      key: "previous",
      label: "Året innan",
      role: "previous",
      values: [3900, 4010, 3870, 4100, 4200, 4350, 4280, 4400, 4520, 4480, 4610, 4700],
    },
  ],
  unit: "h",
  highlightIndex: months.length - 1,
};

export const barChart: ChartData = {
  categories: monthLabels.slice(-6),
  series: [
    {
      key: "revenue",
      label: "Fakturerat",
      role: "primary",
      values: [1_820_000, 1_940_000, 2_110_000, 1_760_000, 2_260_000, 2_410_000],
    },
  ],
  unit: "kr",
  highlightIndex: 5,
};

export const toplistChart: ChartData = {
  categories: ["Kund Alfa AB", "Beta Logistik", "Gamma Vård", "Delta Industri", "Epsilon Bygg"],
  series: [{ key: "hours", label: "Timmar", role: "primary", values: [1240, 980, 760, 520, 310] }],
  unit: "h",
  highlightIndex: 0,
};

export const stackedChart: ChartData = {
  categories: monthLabels.slice(-6),
  series: [
    { key: "MBAB", label: "MB AB", role: "primary", values: [182, 190, 205, 176, 214, 228] },
    { key: "MBR", label: "MB Restart", role: "secondary", values: [64, 71, 69, null, 80, 86] },
  ],
  unit: "st",
  highlightIndex: null,
};

export const donutChart: ChartData = {
  categories: ["ROM2", "KROM", "KVL", "Stöd och matchning", "Karriärvägledning"],
  series: [
    { key: "participants", label: "Deltagare", role: "primary", values: [148, 96, 41, 27, 12] },
  ],
  unit: "st",
  highlightIndex: 1,
};
