import type { ChartData } from "@/lib/contracts";

export interface MbChartProps {
  data: ChartData;
  /** Accessible name (figure label, SVG title, data table caption). */
  title: string;
  description?: string;
  /** Entry animation. Pass false for frozen reports, print and PDF; reduced motion always wins. */
  animate?: boolean;
  /** Plot height in px. */
  height?: number;
  className?: string;
}
