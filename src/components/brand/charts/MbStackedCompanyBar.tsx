"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartFigure } from "./ChartFigure";
import { chartConfigFor, formatAxisTick, seriesStyles, toChartRows } from "./chart-format";
import { axisTick, tooltipFormatter, useChartAnimation } from "./chart-parts";
import type { MbChartProps } from "./types";

export interface MbStackedCompanyBarProps extends MbChartProps {
  /** Print the stacked total (Summa bolag) above each column. */
  showTotals?: boolean;
}

const TOTAL_KEY = "total";

/**
 * One column per month, stacked per company (one series per company: MB AB antracit,
 * MB Restart blue). The stack shows "Summa bolag", which is not an eliminated group total.
 */
export function MbStackedCompanyBar({
  data,
  title,
  description,
  animate = true,
  height = 280,
  showTotals = false,
  fontSize,
  yAxisWidth,
  className,
}: MbStackedCompanyBarProps) {
  const animated = useChartAnimation(animate);
  const tick = axisTick(fontSize);
  const styles = seriesStyles(data.series);
  const rows = toChartRows(data).map((row) => {
    const parts = styles
      .map((s) => row[s.dataKey])
      .filter((v): v is number => typeof v === "number");
    return { ...row, [TOTAL_KEY]: parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null };
  });
  const tickFormatter = (v: number) => formatAxisTick(v, data.unit);

  return (
    <ChartFigure title={title} description={description} data={data} className={className}>
      <ChartContainer
        config={chartConfigFor(styles)}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <BarChart
          data={rows}
          margin={{ top: showTotals ? 20 : 12, right: 12, bottom: 0, left: 0 }}
          title={title}
          desc={description}
          barCategoryGap="18%"
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="category"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={12}
            tick={tick}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={yAxisWidth ?? "auto"}
            tick={tick}
            tickFormatter={tickFormatter}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={<ChartTooltipContent formatter={tooltipFormatter(data.unit)} />}
          />
          <ChartLegend verticalAlign="bottom" content={<ChartLegendContent />} />
          {styles.map((s, i) => {
            const top = i === styles.length - 1;
            return (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label}
                stackId="bolag"
                fill={`var(--color-${s.dataKey})`}
                radius={top ? [4, 4, 0, 0] : 0}
                isAnimationActive={animated}
              >
                {showTotals && top ? (
                  <LabelList
                    dataKey={TOTAL_KEY}
                    position="top"
                    offset={6}
                    fill="var(--foreground)"
                    fontSize={tick.fontSize}
                    formatter={(v) => (typeof v === "number" ? tickFormatter(v) : "")}
                  />
                ) : null}
              </Bar>
            );
          })}
        </BarChart>
      </ChartContainer>
    </ChartFigure>
  );
}
