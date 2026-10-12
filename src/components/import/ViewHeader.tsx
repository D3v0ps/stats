"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";

/** Heading of a view inside the upload page; it takes focus so screen readers announce the change. */
export function ViewHeader({
  title,
  description,
  onBack,
  backLabel = "Tillbaka till filerna",
  actions,
}: {
  title: string;
  description?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-4">
      {onBack ? (
        <div>
          <Button variant="ghost" className="-ml-2" onClick={onBack} data-testid="back-button">
            <ArrowLeft aria-hidden="true" />
            {backLabel}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div ref={heading} tabIndex={-1} className="flex min-w-0 flex-col gap-2 outline-none">
          <Heading level={2} accent="dot">
            {title}
          </Heading>
          {description ? (
            <div className="max-w-3xl text-sm text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
