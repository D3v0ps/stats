import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Heading, type HeadingAccent } from "./Heading";

export interface SectionProps extends Omit<ComponentPropsWithoutRef<"section">, "title"> {
  title: string;
  description?: ReactNode;
  /** Controls on the right of the heading (filters, "Visa alla"). */
  actions?: ReactNode;
  level?: 2 | 3;
  accent?: HeadingAccent;
}

/** A titled page section; the heading labels the region for assistive technology. */
export function Section({
  title,
  description,
  actions,
  level = 2,
  accent = "none",
  className,
  children,
  ...props
}: SectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-slot="section"
      className={cn("flex flex-col gap-4 md:gap-5", className)}
      {...props}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Heading id={headingId} level={level} accent={accent}>
            {title}
          </Heading>
          {description ? (
            <div className="max-w-prose text-sm text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
