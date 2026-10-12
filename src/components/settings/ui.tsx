// Small building blocks shared by the settings sections: card surface, labelled fields with
// hint/error wiring, and a native select styled like the inputs (native for keyboard, screen
// reader and mobile support).
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const CARD = "rounded-card bg-card p-5 shadow-soft md:p-6";

/**
 * Error text: antracit with a red rule, like the login form. Small red text on white fails the
 * contrast requirement (red is for highlights and large text only).
 */
export const ERROR_TEXT = "border-l-2 border-rod pl-2 font-medium text-antracit";

export function SettingsCard({ className, children, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn(CARD, className)} {...props}>
      {children}
    </div>
  );
}

export interface FieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

/** Label above the control; hint and error are referenced via aria-describedby ids. */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className={cn(ERROR_TEXT, "text-xs")}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** aria-describedby for a Field's control. */
export function describedBy(
  id: string,
  opts: { hint?: unknown; error?: unknown },
): string | undefined {
  const ids = [opts.hint ? `${id}-hint` : null, opts.error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function NativeSelect({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** Calm inline notice (antracit on light grey); `tone="warning"` adds a red left rule. */
export function Notice({
  tone = "info",
  className,
  children,
}: {
  tone?: "info" | "warning";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl bg-ljusgra-100 px-4 py-3 text-sm text-antracit",
        tone === "warning" && "border-l-4 border-rod",
        className,
      )}
    >
      {children}
    </div>
  );
}
