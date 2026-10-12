"use client";

import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/** A modal form in Swedish (title, plain-words description, Avbryt + primary action). */
export function ImportDialog({
  open,
  onClose,
  title,
  description,
  children,
  submitLabel,
  busy = false,
  onSubmit,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  submitLabel: string;
  busy?: boolean;
  onSubmit: () => void;
  testId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-lg"
        data-testid={testId}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <DialogTitle className="text-base font-medium tracking-[0.06em] uppercase">
                {title}
              </DialogTitle>
              {description ? (
                <DialogDescription className="text-sm text-muted-foreground">
                  {description}
                </DialogDescription>
              ) : null}
            </div>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Stäng">
                <X aria-hidden="true" />
              </Button>
            </DialogClose>
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Avbryt
            </Button>
            <Button
              type="submit"
              disabled={busy}
              data-testid={testId ? `${testId}-submit` : undefined}
            >
              {busy ? "Vänta…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
