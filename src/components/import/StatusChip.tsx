import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { StatusTone } from "@/lib/import-ui/queue";
import { cn } from "@/lib/utils";

const TONE: Record<StatusTone, string> = {
  busy: "bg-ljusgra-100 text-antracit-300",
  attention: "bg-bla-100 text-antracit ring-1 ring-bla",
  ready: "bg-bla-200 text-antracit",
  done: "bg-antracit text-white",
  muted: "bg-ljusgra-200 text-antracit-300",
  error: "bg-rod-100 text-antracit",
};

export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: string;
  className?: string;
}) {
  return (
    <span
      data-testid="status-chip"
      data-tone={tone}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      {tone === "busy" ? (
        <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
      ) : null}
      {tone === "done" ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      {tone === "error" ? (
        <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-rod" />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
