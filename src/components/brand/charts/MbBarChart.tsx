"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartFigure } from "./ChartFigure";
import { barFill, chartConfigFor, formatAxisTick, seriesStyles, toChartRows } from "./chart-format";
import {
  CategoryLinkList,
  axisTick,
  tooltipFormatter,
  useCategoryDrill,
  useChartAnimation,
} from "./chart-parts";
import type { MbChartProps } from "./types";

export interface MbBarChartProps extends MbChartProps {
  /** "vertical" = columns (months), "horizontal" = bars with labels on the left (toplists). */
  orientation?: "vertical" | "horizontal";
  /** Print the value at the end of each bar (slides). */
  showValues?: boolean;
}

/**
 * Bars per category. The primary series is antracit and the highlighted category (current
 * month, the customer being discussed) is red; extra series follow the chart roles.
 */
export function MbBarChart({
  data,
  title,
  description,
  animate = true,
  height,
  orientation = "vertical",
  showValues = false,
  categoryHrefs,
  onCategoryClick,
  fontSize,
  yAxisWidth,
  className,
}: MbBarChartProps) {
  const animated = useChartAnimation(animate);
  const drill = useCategoryDrill(categoryHrefs, onCategoryClick);
  const tick = axisTick(fontSize);
  const horizontal = orientation === "horizontal";
  const styles = seriesStyles(data.series);
  const rows = toChartRows(data);
  const highlightKey = (styles.find((s) => s.role === "primary") ?? styles[0])?.dataKey;
  const radius: [number, number, number, number] = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  const plotHeight =
    height ??
    (horizontal ? Math.max(160, data.categories.length * (styles.length * 18 + 14)) : 280);
  const tickFormatter = (v: number) => formatAxisTick(v, data.unit);

  return (
    <ChartFigure title={title} description={description} data={data} className={className}>
      <ChartContainer
        config={chartConfigFor(styles)}
        className="aspect-auto w-full"
        style={{ height: plotHeight }}
      >
        <BarChart
          data={rows}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{
            top: showValues ? 20 : 12,
            right: showValues && horizontal ? 56 : 12,
            bottom: 0,
            left: 0,
          }}
          title={title}
          desc={description}
          barCategoryGap={horizontal ? "22%" : "18%"}
        >
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--border)" />
          <XAxis
            type={horizontal ? "number" : "category"}
            dataKey={horizontal ? undefined : "category"}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={12}
            tick={tick}
            tickFormatter={horizontal ? tickFormatter : undefined}
          />
          <YAxis
            type={horizontal ? "category" : "number"}
            dataKey={horizontal ? "category" : undefined}
            // Every bar of a toplist needs its label.
            interval={horizontal ? 0 : undefined}
            tickLine={false}
            axisLine={false}
            width={yAxisWidth ?? "auto"}
            tick={tick}
            tickFormatter={horizontal ? undefined : tickFormatter}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={<ChartTooltipContent formatter={tooltipFormatter(data.unit)} />}
          />
          {styles.length > 1 ? (
            <ChartLegend verticalAlign="bottom" content={<ChartLegendContent />} />
          ) : null}
          {styles.map((s) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.label}
              fill={`var(--color-${s.dataKey})`}
              radius={radius}
              isAnimationActive={animated}
              className={drill.active ? "cursor-pointer" : undefined}
              onClick={drill.active ? (_bar, index) => drill.open(index) : undefined}
              shape={
                s.dataKey === highlightKey && data.highlightIndex !== null
                  ? (props: BarShapeProps) => (
                      <Rectangle
                        x={props.x}
                        y={props.y}
                        width={props.width}
                        height={props.height}
                        radius={radius}
                        fill={barFill(
                          `var(--color-${s.dataKey})`,
                          props.index,
                          data.highlightIndex,
                        )}
                      />
                    )
                  : undefined
              }
            >
              {showValues ? (
                <LabelList
                  dataKey={s.dataKey}
                  position={horizontal ? "right" : "top"}
                  offset={6}
                  fill="var(--foreground)"
                  fontSize={tick.fontSize}
                  formatter={(v) => (typeof v === "number" ? tickFormatter(v) : "")}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
      <CategoryLinkList
        title={title}
        categories={data.categories}
        hrefs={categoryHrefs}
        navRef={drill.navRef}
      />
    </ChartFigure>
  );
}
