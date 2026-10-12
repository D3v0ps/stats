import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Heading } from "@/components/brand/Heading";
import { formatDateSv } from "@/lib/core/format-sv";
import type { SourceQuery } from "@/lib/dashboard/load-dashboard";
import { cn } from "@/lib/utils";
import { CARD } from "./grid-classes";
import { SourcePopover } from "./SourcePopover";

export interface ChartCardProps {
  title: string;
  subtitle?: string | null;
  /** Drill-down into Utforska. */
  href?: string | null;
  hrefLabel?: string;
  footnote?: string | null;
  lastUpdatedAt?: string | null;
  sourceQuery?: SourceQuery | null;
  /** Extra header controls (e.g. CSV export), before Källa and the Utforska link. */
  actions?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}

/** Card around a chart or table: uppercase title, Utforska link, Källa, quiet footnotes. */
export function ChartCard({
  title,
  subtitle,
  href,
  hrefLabel = "Utforska",
  footnote,
  lastUpdatedAt,
  sourceQuery,
  actions,
  testId,
  className,
  children,
}: ChartCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn(CARD, "flex h-full min-w-0 flex-col gap-4", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={3} id={headingId}>
            {title}
          </Heading>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {sourceQuery ? <SourcePopover query={sourceQuery} subject={title} /> : null}
          {href ? (
            <Link
              href={href}
              data-testid={testId ? `${testId}-explore` : undefined}
              aria-label={`${hrefLabel}: ${title}`}
              className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {hrefLabel}
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="min-w-0 flex-1">{children}</div>
      {footnote || lastUpdatedAt ? (
        <footer className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {footnote ? <p>{footnote}</p> : null}
          {lastUpdatedAt ? <p>Senast uppdaterad {formatDateSv(lastUpdatedAt)}</p> : null}
        </footer>
      ) : null}
    </section>
  );
}
