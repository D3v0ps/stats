import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FormMessageProps {
  kind?: "error" | "success";
  children: React.ReactNode;
  className?: string;
}

/**
 * Inline status text. Red only on the icon: small red text on white fails contrast, and the
 * meaning never depends on colour alone.
 */
export function FormMessage({ kind = "error", children, className }: FormMessageProps) {
  const Icon = kind === "error" ? CircleAlert : CircleCheck;
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2 text-sm text-foreground", className)}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", kind === "error" ? "text-rod" : "text-bla")}
      />
      <span>{children}</span>
    </p>
  );
}
