import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Delta } from "@/components/brand/Delta";
import type { SortState } from "@/lib/dashboard/explore-state";
import type { ExploreRowLinks } from "@/lib/dashboard/load-explore";
import { cellOf, type PivotColumn, type PivotModel, type PivotRow } from "@/lib/dashboard/pivot";
import { cn } from "@/lib/utils";

export interface PivotTableProps {
  model: PivotModel;
  rows: PivotRow[];
  rowLinks: Record<string, ExploreRowLinks>;
  sortLinks: Record<string, string>;
  sort: SortState | null;
  caption: string;
  /** Accessible name of the entity link, e.g. "Kundkort". */
  entityLabel?: string;
  /** Rows without a link (Övriga, (saknas)) are muted; off for tables of metric names. */
  muteUnlinked?: boolean;
  testId?: string;
}

const STICKY = "sticky left-0 z-[1] bg-card";
/** Cells line up with the card padding at both table edges. */
const EDGES = "first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6";

function SortHeader({
  label,
  title,
  sortKey,
  href,
  sort,
  align,
  testId,
}: {
  label: string;
  title?: string;
  sortKey: string;
  href: string | undefined;
  sort: SortState | null;
  align: "left" | "right";
  testId?: string;
}) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none";
  // The arrow sits on the inner side so labels line up with left/right aligned values.
  const arrow = (
    <span aria-hidden="true" className={cn("text-[0.6rem]", !active && "opacity-0")}>
      {sort?.dir === "asc" && active ? "▲" : "▼"}
    </span>
  );
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "px-3 py-2.5 align-bottom text-xs font-medium whitespace-nowrap text-muted-foreground",
        EDGES,
        align === "right" ? "text-right" : "text-left",
        sortKey === "label" && STICKY,
      )}
    >
      {href ? (
        <Link
          href={href}
          scroll={false}
          title={title}
          data-testid={testId ? `${testId}-sort-${sortKey}` : undefined}
          className={cn(
            "inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            active && "text-foreground",
          )}
        >
          {align === "right" ? arrow : null}
          {label}
          {align === "left" ? arrow : null}
          <span className="sr-only">, sortera</span>
        </Link>
      ) : (
        label
      )}
    </th>
  );
}

function Cell({ row, column }: { row: PivotRow; column: PivotColumn }) {
  const cell = cellOf(row, column.key);
  if (column.kind === "delta") {
    return (
      <td className={cn("px-3 py-2.5 text-right whitespace-nowrap", EDGES)}>
        {cell.delta ? (
          <Delta delta={cell.delta} showAgainst={false} size="sm" />
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
    );
  }
  return (
    <td
      className={cn(
        "num px-3 py-2.5 text-right whitespace-nowrap",
        EDGES,
        column.kind === "coverage" && "text-xs text-muted-foreground",
        column.kind === "budget" && "text-muted-foreground",
      )}
    >
      <span className="flex flex-col items-end gap-0.5">
        <span className={cn(cell.raw === null && "text-muted-foreground")}>{cell.text}</span>
        {column.kind === "value" && cell.delta !== undefined ? (
          <Delta delta={cell.delta} showAgainst={false} size="sm" />
        ) : null}
      </span>
    </td>
  );
}

/**
 * The breakdown table. Sorting and drilling are plain links (URL state), so the table works
 * before hydration and every view can be shared. Clicking a row drills down; the arrow opens
 * the entity page (kundkort).
 */
export function PivotTable({
  model,
  rows,
  rowLinks,
  sortLinks,
  sort,
  caption,
  entityLabel = "Öppna",
  muteUnlinked = true,
  testId = "pivot",
}: PivotTableProps) {
  return (
    <div className="relative -mx-5 overflow-x-auto md:-mx-6" data-testid={testId}>
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            <SortHeader
              label={model.groupLabel}
              sortKey="label"
              href={sortLinks.label}
              sort={sort}
              align="left"
              testId={testId}
            />
            {model.columns.map((c) => (
              <SortHeader
                key={c.key}
                label={c.label}
                title={c.title}
                sortKey={c.key}
                href={sortLinks[c.key]}
                sort={sort}
                align="right"
                testId={testId}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const links = rowLinks[row.key];
            // Without a drill-down (entity pages) the label itself opens the entity page.
            const labelHref = links?.drill ?? links?.entity ?? null;
            const separateEntity = Boolean(links?.drill && links.entity);
            return (
              <tr
                key={row.key}
                data-testid={`${testId}-row`}
                className="group relative border-b border-border/60 transition-colors last:border-0 hover:bg-ljusgra-100"
              >
                <th
                  scope="row"
                  className={cn(
                    STICKY,
                    EDGES,
                    "px-3 py-2.5 text-left font-normal group-hover:bg-ljusgra-100",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {labelHref ? (
                      <Link
                        href={labelHref}
                        scroll={links?.drill ? false : undefined}
                        data-testid={`${testId}-${links?.drill ? "drill" : "entity"}`}
                        className="max-w-[16rem] truncate rounded after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {row.label}
                      </Link>
                    ) : (
                      <span
                        className={cn(
                          "max-w-[16rem] truncate",
                          muteUnlinked && "text-muted-foreground",
                        )}
                      >
                        {row.label}
                      </span>
                    )}
                    {separateEntity && links?.entity ? (
                      <Link
                        href={links.entity}
                        aria-label={`${entityLabel}: ${row.label}`}
                        title={entityLabel}
                        data-testid={`${testId}-entity`}
                        className="relative z-[2] inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 transition hover:bg-card hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none group-hover:opacity-100"
                      >
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      </Link>
                    ) : null}
                  </span>
                </th>
                {model.columns.map((c) => (
                  <Cell key={c.key} row={row} column={c} />
                ))}
              </tr>
            );
          })}
        </tbody>
        {model.footer.length > 0 ? (
          <tfoot>
            {model.footer.map((row) => (
              <tr
                key={row.key}
                data-testid={`${testId}-${row.kind}`}
                className={cn(
                  "border-border",
                  row.kind === "total"
                    ? "border-t-2 font-medium"
                    : "border-t text-muted-foreground italic",
                )}
              >
                <th
                  scope="row"
                  className={cn(STICKY, EDGES, "px-3 py-2.5 text-left font-[inherit]")}
                >
                  {row.label}
                </th>
                {model.columns.map((c) => (
                  <Cell key={c.key} row={row} column={c} />
                ))}
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
