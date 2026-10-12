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
  /**
   * Drill-down per category, aligned with data.categories (null = not drillable). Bars and
   * slices open it on click, and keyboard users get the same links in a list that shows when
   * it takes focus. Ignored by the monthly charts (line, stacked company).
   */
  categoryHrefs?: readonly (string | null)[];
  /** Click on a category without an href (client components only). */
  onCategoryClick?: (index: number) => void;
  /** Axis label size in px (12 by default; miniatures use smaller). */
  fontSize?: number;
  /** Width of the value axis in px; omitted = sized to the labels. */
  yAxisWidth?: number;
  className?: string;
}
