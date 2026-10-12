import type { ReactNode } from "react";
import type { ChartData } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { chartTableRows } from "./chart-format";

export interface ChartFigureProps {
  /** Accessible name of the chart (the visible heading usually lives in the card/slide). */
  title: string;
  description?: string;
  data: ChartData;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps a chart in a labelled <figure> with a visually hidden data table, so screen reader
 * users get every number the chart shows.
 */
export function ChartFigure({ title, description, data, className, children }: ChartFigureProps) {
  const rows = chartTableRows(data);
  return (
    <figure aria-label={title} data-slot="chart-figure" className={cn("m-0 min-w-0", className)}>
      {children}
      <figcaption className="sr-only">
        {title}
        {description ? `. ${description}` : null}
      </figcaption>
      {rows.length > 0 ? (
        // Tables ignore width: 1px, so the visually hidden wrapper is a div.
        <div className="sr-only">
          <table>
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">Kategori</th>
                {data.series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.label}-${i}`}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((v, j) => (
                    <td key={j}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}
