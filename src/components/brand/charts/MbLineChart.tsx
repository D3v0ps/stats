"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis, type DotItemDotProps } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartFigure } from "./ChartFigure";
import { chartConfigFor, formatAxisTick, seriesStyles, toChartRows } from "./chart-format";
import { AXIS_TICK, tooltipFormatter, useChartAnimation } from "./chart-parts";
import type { MbChartProps } from "./types";

/**
 * Monthly trend: current period (primary, antracit) against the previous period (light grey,
 * dashed). The highlighted month gets a red dot. Missing months are gaps, never zeros.
 */
export function MbLineChart({
  data,
  title,
  description,
  animate = true,
  height = 280,
  className,
}: MbChartProps) {
  const animated = useChartAnimation(animate);
  const styles = seriesStyles(data.series);
  const rows = toChartRows(data);
  const highlightKey = (styles.find((s) => s.role === "primary") ?? styles[0])?.dataKey;

  const highlightDot = (props: DotItemDotProps) => {
    const { cx, cy, index } = props;
    if (index !== data.highlightIndex || cx === undefined || cy === undefined) return null;
    return (
      <circle
        key={`hl-${index}`}
        cx={cx}
        cy={cy}
        r={5}
        fill="var(--chart-highlight)"
        stroke="var(--card)"
        strokeWidth={2}
      />
    );
  };

  return (
    <ChartFigure title={title} description={description} data={data} className={className}>
      <ChartContainer
        config={chartConfigFor(styles)}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <LineChart
          data={rows}
          margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
          title={title}
          desc={description}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="category"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={12}
            tick={AXIS_TICK}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            tick={AXIS_TICK}
            tickFormatter={(v: number) => formatAxisTick(v, data.unit)}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)" }}
            content={<ChartTooltipContent formatter={tooltipFormatter(data.unit)} />}
          />
          {styles.length > 1 ? (
            <ChartLegend verticalAlign="bottom" content={<ChartLegendContent />} />
          ) : null}
          {styles.map((s) => (
            <Line
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.label}
              type="monotone"
              stroke={`var(--color-${s.dataKey})`}
              strokeWidth={s.dashed ? 2 : 2.5}
              strokeDasharray={s.dashed ? "5 5" : undefined}
              dot={
                s.dataKey === highlightKey && data.highlightIndex !== null ? highlightDot : false
              }
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={animated}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </ChartFigure>
  );
}
