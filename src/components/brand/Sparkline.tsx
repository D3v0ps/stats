import { cn } from "@/lib/utils";
import { sparklineGeometry } from "./sparkline-geometry";

export interface SparklineProps {
  /** Monthly values, oldest first. null = month without data (drawn as a gap). */
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  /** Accessible description; without it the sparkline is decorative (aria-hidden). */
  label?: string;
  /** Draw-in animation. Off for frozen/print views; reduced motion disables it in CSS. */
  animate?: boolean;
  className?: string;
}

/** Hand-rolled SVG trend line: antracit stroke, red dot on the latest value. */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  strokeWidth = 2,
  label,
  animate = true,
  className,
}: SparklineProps) {
  const padding = Math.max(strokeWidth, 4);
  const { segments, isolated, last } = sparklineGeometry(values, { width, height, padding });
  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true, focusable: false } as const);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("block overflow-visible", className)}
      data-slot="sparkline"
      {...a11y}
    >
      {label ? <title>{label}</title> : null}
      {segments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--chart-primary)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          {...(animate ? { pathLength: 1, className: "animate-draw [stroke-dasharray:1]" } : {})}
        />
      ))}
      {isolated.map((p) => (
        <circle key={p.index} cx={p.x} cy={p.y} r={strokeWidth} fill="var(--chart-primary)" />
      ))}
      {last ? (
        <circle
          cx={last.x}
          cy={last.y}
          r={strokeWidth + 1.5}
          fill="var(--chart-highlight)"
          stroke="var(--card)"
          strokeWidth={1.5}
          data-slot="sparkline-last"
        />
      ) : null}
    </svg>
  );
}
