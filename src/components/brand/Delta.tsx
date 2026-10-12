import { MISSING } from "@/lib/core/format-sv";
import { cn } from "@/lib/utils";
import {
  DELTA_GLYPH,
  deltaAriaLabel,
  deltaTone,
  type DeltaLike,
  type DeltaTone,
} from "./delta-text";

const TONE_CLASS: Record<DeltaTone, string> = {
  // Foreground is antracit in the app and white in presentation mode.
  favorable: "text-foreground",
  unfavorable: "text-rod",
  neutral: "text-muted-foreground",
};

const SIZE_CLASS = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-lg",
} as const;

export interface DeltaProps {
  /** null renders a muted dash ("Jämförelse saknas"). */
  delta: DeltaLike | null;
  /** Show the comparison label ("mot aug 2026") after the change. */
  showAgainst?: boolean;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}

/** ▲ +12 % mot aug 2026 – glyph and sign carry the direction, colour only the judgement. */
export function Delta({ delta, showAgainst = true, size = "md", className }: DeltaProps) {
  if (!delta) {
    return (
      <span
        role="img"
        aria-label="Jämförelse saknas"
        className={cn("num text-muted-foreground", SIZE_CLASS[size], className)}
      >
        {MISSING}
      </span>
    );
  }
  const against = delta.againstLabel.trim();
  return (
    <span
      role="img"
      aria-label={deltaAriaLabel(delta)}
      data-direction={delta.direction}
      data-tone={deltaTone(delta.favorable)}
      className={cn(
        "num inline-flex flex-wrap items-baseline gap-x-1.5",
        SIZE_CLASS[size],
        className,
      )}
    >
      <span
        className={cn("font-semibold whitespace-nowrap", TONE_CLASS[deltaTone(delta.favorable)])}
      >
        <span className="mr-1 text-[0.8em]">{DELTA_GLYPH[delta.direction]}</span>
        {delta.formatted}
      </span>
      {showAgainst && against ? (
        <span className="whitespace-nowrap text-muted-foreground">{against}</span>
      ) : null}
    </span>
  );
}
