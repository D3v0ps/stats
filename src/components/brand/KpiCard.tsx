import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Unit } from "@/lib/contracts";
import { formatDateSv, type FormatOptions } from "@/lib/core/format-sv";
import { cn } from "@/lib/utils";
import { CountUp } from "./CountUp";
import { Delta } from "./Delta";
import type { DeltaLike } from "./delta-text";
import { Sparkline } from "./Sparkline";

/**
 * Other attributes (data-testid, aria-*, id …) go to the card's <article>. `title` and
 * `onClick` are the card's own props, not the HTML attributes.
 */
export interface KpiCardProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title" | "onClick" | "children"
> {
  title: string;
  /** null = no published data for the period ("Saknas"). */
  value: number | null;
  unit: Unit;
  /** e.g. { compact: true } for "2,4 mkr". */
  formatOptions?: FormatOptions;
  /** Omit to hide the delta row; null shows "–" (nothing to compare with). */
  delta?: DeltaLike | null;
  /** A second comparison under the first, e.g. against budget ("mot budget"); null hides it. */
  secondaryDelta?: DeltaLike | null;
  /** Monthly values, oldest first. */
  sparkline?: readonly (number | null)[] | null;
  sparklineLabel?: string;
  /** ISO timestamp of the newest upload behind the number. */
  lastUpdatedAt?: string | null;
  /** e.g. "2 av 3 mån har data", "Summa bolag (ej eliminerat)". */
  footnote?: string | null;
  /** Drill-down target. The whole card is clickable; the title is the link text. */
  href?: string;
  /** Drill-down handler (client components only). Ignored when href is set. */
  onClick?: () => void;
  /** Accessible name of the drill-down when the title alone is not enough. */
  actionLabel?: string;
  loading?: boolean;
  /** Frozen/print views: no count-up, no draw-in. */
  static?: boolean;
  /**
   * Controls in the card's bottom-right corner, e.g. the Källa button. They sit above the
   * stretched drill-down link, so they stay clickable on a clickable card.
   */
  actions?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

const CARD = "relative flex min-w-0 flex-col gap-4 rounded-card bg-card p-5 shadow-soft md:p-6";
const TITLE = "text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase";

export function KpiCard(props: KpiCardProps) {
  const {
    title,
    value,
    unit,
    formatOptions,
    delta,
    secondaryDelta,
    sparkline,
    sparklineLabel,
    lastUpdatedAt,
    footnote,
    href,
    onClick,
    actionLabel,
    loading = false,
    static: isStatic = false,
    actions,
    className,
    ...rest
  } = props;

  if (loading) {
    return (
      <article {...rest} aria-busy="true" data-slot="kpi-card" className={cn(CARD, className)}>
        <span className="sr-only">Laddar {title}</span>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-3 w-24" />
      </article>
    );
  }

  const interactive = Boolean(href ?? onClick);
  const stretched =
    "text-left after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none";
  const titleNode = href ? (
    <Link href={href} aria-label={actionLabel} className={cn(TITLE, stretched)}>
      {title}
    </Link>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={actionLabel}
      className={cn(TITLE, stretched)}
    >
      {title}
    </button>
  ) : (
    <span className={TITLE}>{title}</span>
  );
  const hasSparkline = Boolean(sparkline?.some((v) => v !== null));

  return (
    <article
      {...rest}
      data-slot="kpi-card"
      data-static={isStatic ? "" : undefined}
      className={cn(
        CARD,
        interactive &&
          "transition-shadow hover:shadow-md has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/60",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="m-0">{titleNode}</h3>
        {interactive ? (
          <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        ) : null}
      </header>

      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          {value === null ? (
            <p className="text-3xl leading-none font-light text-muted-foreground md:text-4xl">
              Saknas
              <span className="sr-only"> – ingen publicerad data för perioden</span>
            </p>
          ) : (
            <p className="text-3xl leading-none font-light tracking-tight md:text-4xl">
              <CountUp value={value} unit={unit} formatOptions={formatOptions} static={isStatic} />
            </p>
          )}
          {delta !== undefined && value !== null ? <Delta delta={delta} size="sm" /> : null}
          {secondaryDelta && value !== null ? (
            <Delta delta={secondaryDelta} size="sm" className="-mt-1" />
          ) : null}
        </div>
        {hasSparkline && sparkline ? (
          <Sparkline
            values={sparkline}
            label={sparklineLabel}
            animate={!isStatic}
            className="h-auto w-24 shrink-0 md:w-28"
          />
        ) : null}
      </div>

      {lastUpdatedAt || footnote || actions ? (
        <footer className="mt-auto flex items-end justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-col gap-0.5">
            {footnote ? <p>{footnote}</p> : null}
            {lastUpdatedAt ? <p>Senast uppdaterad {formatDateSv(lastUpdatedAt)}</p> : null}
          </div>
          {actions ? (
            <div data-slot="kpi-actions" className="relative z-10 -mr-2 -mb-1 flex shrink-0 gap-1">
              {actions}
            </div>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
