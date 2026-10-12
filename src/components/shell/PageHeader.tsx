import type { ReactNode } from "react";
import { Heading } from "@/components/brand/Heading";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Page-level controls (filters, primary action) aligned to the right on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/** Page title (h1, uppercase with the red dot) with an optional lead and actions. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-8 flex flex-col gap-4 md:mb-10 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <Heading level={1} accent="dot">
          {title}
        </Heading>
        {description ? (
          <div className="max-w-2xl text-sm text-pretty text-muted-foreground md:text-base">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
