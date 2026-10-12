import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Decorative icon (e.g. a lucide icon); hidden from screen readers. */
  icon?: ReactNode;
  /** Primary next step, e.g. a link to "Ladda upp". */
  action?: ReactNode;
  className?: string;
}

/** Calm placeholder for "nothing here yet": no alarm colours, one clear next step. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-antracit-100 bg-card px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-1 flex size-12 items-center justify-center rounded-full bg-ljusgra-100 text-antracit-300 [&_svg]:size-6"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium tracking-[0.08em] text-foreground uppercase">{title}</p>
      {description ? (
        <div className="max-w-md text-sm text-pretty text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
