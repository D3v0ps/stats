import Link from "next/link";
import { Delta } from "@/components/brand/Delta";
import { cn } from "@/lib/utils";
import type { ToplistRow } from "./toplist-rows";

export interface ToplistBarsProps {
  rows: ToplistRow[];
  /** Accessible name of the list, e.g. "Timmar per kund". */
  label: string;
  testId?: string;
}

/**
 * Ranked list with inline bars. Every named row links to its entity page (kundkort);
 * "Övriga" is shown muted and is not a link.
 */
export function ToplistBars({ rows, label, testId }: ToplistBarsProps) {
  return (
    <ol aria-label={label} className="flex flex-col gap-1" data-testid={testId}>
      {rows.map((row, i) => {
        const body = (
          <>
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {row.rank ?? ""}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "truncate text-sm",
                    row.others ? "text-muted-foreground" : "text-foreground",
                    row.href && "group-hover:underline group-hover:underline-offset-4",
                  )}
                >
                  {row.label}
                </span>
                <span className="num shrink-0 text-sm font-medium tabular-nums">
                  {row.formatted}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-ljusgra-100"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      row.others ? "bg-antracit-100" : "bg-antracit",
                    )}
                    style={{ width: `${Math.round(row.share * 1000) / 10}%` }}
                  />
                </span>
                {row.delta ? (
                  <Delta delta={row.delta} showAgainst={false} size="sm" className="shrink-0" />
                ) : null}
              </span>
            </span>
          </>
        );
        return (
          <li key={`${row.label}-${i}`}>
            {row.href ? (
              <Link
                href={row.href}
                data-testid={testId ? `${testId}-row-${i}` : undefined}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-ljusgra-100 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-2 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
