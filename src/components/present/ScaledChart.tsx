"use client";

import type { ReactNode } from "react";
import { chartScale } from "@/lib/present/slide-view";
import { cn } from "@/lib/utils";
import { useElementSize, type ElementSize } from "./use-element-size";

export interface ScaledChartProps {
  /** false: lay the chart out at its real size (miniatures). */
  scaleUp?: boolean;
  className?: string;
  /** Renders the chart for the logical (unscaled) size. */
  children: (size: ElementSize) => ReactNode;
}

/**
 * Fills its box with a chart laid out at a smaller logical size and scaled up with a CSS
 * transform, so the brand charts' 12 px axis labels grow with a projector screen. Never
 * scales down: Recharts sizes the y-axis from transformed label boxes, so a shrinking
 * transform would clip the labels (a growing one only adds a little room).
 */
export function ScaledChart({ scaleUp = true, className, children }: ScaledChartProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const scale = scaleUp ? chartScale(size.width) : 1;
  const logical = { width: size.width / scale, height: size.height / scale };
  return (
    <div ref={ref} className={cn("relative h-full min-h-0 w-full min-w-0", className)}>
      {size.width > 0 && size.height > 0 ? (
        <div
          className="absolute top-0 left-0"
          style={{
            width: logical.width,
            height: logical.height,
            transform: scale === 1 ? undefined : `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {children(logical)}
        </div>
      ) : null}
    </div>
  );
}
