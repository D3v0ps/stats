"use client";

import { Pie, PieChart, Sector, type PieSectorShapeProps } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatPercent, formatValue } from "@/lib/core/format-sv";
import { cn } from "@/lib/utils";
import { ChartFigure } from "./ChartFigure";
import { donutSlices } from "./chart-format";
import { tooltipFormatter, useChartAnimation } from "./chart-parts";
import type { MbChartProps } from "./types";

export interface MbDonutProps extends MbChartProps {
  /** Small caption under the total in the hole, e.g. "Totalt". */
  centerLabel?: string;
  showLegend?: boolean;
}

/**
 * Share of a whole (first series). Categorical brand colours, red only for the highlighted
 * slice. Missing and non-positive values are left out (they have no share).
 */
export function MbDonut({
  data,
  title,
  description,
  animate = true,
  height = 220,
  centerLabel,
  showLegend = true,
  className,
}: MbDonutProps) {
  const animated = useChartAnimation(animate);
  const slices = donutSlices(data);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const config = Object.fromEntries(slices.map((s) => [s.key, { label: s.label, color: s.color }]));
  const pieData = slices.map((s) => ({
    key: s.key,
    label: s.label,
    value: s.value,
    fill: s.color,
  }));

  const sector = (props: PieSectorShapeProps) => (
    <Sector
      cx={props.cx}
      cy={props.cy}
      innerRadius={props.innerRadius}
      outerRadius={props.outerRadius}
      startAngle={props.startAngle}
      endAngle={props.endAngle}
      fill={slices[props.index]?.color}
      stroke="var(--card)"
      strokeWidth={2}
    />
  );

  return (
    <ChartFigure title={title} description={description} data={data} className={className}>
      <div className={cn("flex flex-col items-center gap-6", showLegend && "sm:flex-row")}>
        <div className="relative shrink-0" style={{ width: height, height }}>
          <ChartContainer config={config} className="aspect-square h-full w-full">
            <PieChart title={title} desc={description}>
              <ChartTooltip
                content={<ChartTooltipContent hideLabel formatter={tooltipFormatter(data.unit)} />}
              />
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={slices.length > 1 ? 1.5 : 0}
                isAnimationActive={animated}
                shape={sector}
              />
            </PieChart>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="num text-xl font-light">
              {formatValue(total, data.unit, { compact: true })}
            </span>
            {centerLabel ? (
              <span className="text-[0.65rem] tracking-[0.08em] text-muted-foreground uppercase">
                {centerLabel}
              </span>
            ) : null}
          </div>
        </div>
        {showLegend ? (
          <ul className="grid w-full min-w-0 gap-2 text-sm" aria-hidden="true">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="num shrink-0 text-muted-foreground">
                  {formatValue(s.value, data.unit, { compact: true })} ·{" "}
                  {formatPercent(s.share * 100, { decimals: 0 })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ChartFigure>
  );
}
