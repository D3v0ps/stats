"use client";

// Small form building blocks for the upload flow: a native select (fast in long
// tables, good on phones), a labelled field and a progress bar.
import { ChevronDown } from "lucide-react";
import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface NativeSelectProps extends Omit<ComponentPropsWithoutRef<"select">, "children"> {
  options: readonly SelectOption[];
  /** Shown first with an empty value. */
  placeholder?: string;
}

export function NativeSelect({ options, placeholder, className, ...props }: NativeSelectProps) {
  return (
    <span className={cn("relative inline-flex w-full min-w-0", className)}>
      <select
        className="h-9 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-card py-1 pr-8 pl-2.5 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
        {...props}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="text-xs font-medium tracking-[0.06em] text-antracit-300 uppercase"
      >
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 w-full overflow-hidden rounded-full bg-ljusgra-200"
      >
        <div
          className="h-full rounded-full bg-bla transition-[width] duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="num text-xs text-muted-foreground">
        {label} – {value} %
      </p>
    </div>
  );
}

/**
 * A text input that commits on blur or Enter (one undo step per edit, not per
 * keystroke). Escape restores the committed value.
 */
export function CommitInput({
  value,
  onCommit,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"input">, "value" | "onChange" | "defaultValue"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <input
      // Remount when the committed value changes from outside (undo, rename elsewhere).
      key={value}
      defaultValue={value}
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
        className,
      )}
      onBlur={(e) => {
        if (e.currentTarget.value !== value) onCommit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") e.currentTarget.value = value;
      }}
      {...props}
    />
  );
}

/** A white card with the brand radius. */
export function Panel({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("rounded-card bg-card p-5 shadow-soft md:p-7", className)} {...props} />
  );
}
