"use client";

import { NotebookText } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WINDOW_NAME = "mb-talarmanus";
const WINDOW_FEATURES = "popup=yes,width=1100,height=760";

export interface OpenNotesButtonProps {
  href: string;
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
}

/**
 * Opens the speaker notes in their own window (for the presenter's screen only). Falls back
 * to a new tab when popups are blocked.
 */
export function OpenNotesButton({ href, variant = "ghost", className }: OpenNotesButtonProps) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    const win = window.open(href, WINDOW_NAME, WINDOW_FEATURES);
    if (win) {
      event.preventDefault();
      win.focus();
    }
  };
  return (
    <Button asChild variant={variant} size="lg" className={cn("gap-2", className)}>
      <a href={href} target="_blank" rel="noopener" onClick={open} data-testid="open-notes">
        <NotebookText aria-hidden="true" />
        Talarmanus
      </a>
    </Button>
  );
}
