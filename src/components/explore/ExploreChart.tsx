import { MbBarChart, MbLineChart } from "@/components/brand/charts";
import type { ChartData } from "@/lib/contracts/slides";

/** Per month: trend against last year; per group: horizontal bars against the previous period. */
export function ExploreChart({
  chart,
  title,
  monthMode,
}: {
  chart: ChartData;
  title: string;
  monthMode: boolean;
}) {
  if (monthMode) return <MbLineChart data={chart} title={title} height={280} />;
  return <MbBarChart data={chart} title={title} orientation="horizontal" />;
}
