// Pure helpers behind <Delta>: build a ResolvedDelta from raw numbers and phrase it for
// screen readers. Up/down is always carried by glyph + sign, never by colour alone.
import type { Direction, ResolvedDelta, Unit } from "@/lib/contracts";
import { MISSING, formatDeltaPercent, formatDeltaPp } from "@/lib/core/format-sv";

export type DeltaLike = Pick<
  ResolvedDelta,
  "direction" | "formatted" | "favorable" | "againstLabel"
>;

export const DELTA_GLYPH: Record<Direction, "▲" | "▼" | "●"> = {
  up: "▲",
  down: "▼",
  flat: "●",
};

export interface BuildDeltaInput {
  unit: Unit;
  /** Relative change in percent (12 = +12 %). Used for every unit except pct. */
  deltaPct?: number | null;
  /** Change in percentage points. Used for pct units. */
  deltaPp?: number | null;
  higherIsBetter: boolean | null;
  /** e.g. "mot aug 2026" */
  againstLabel: string;
  decimals?: number;
}

/**
 * The delta shown next to a number. Percent metrics compare in percentage points, all others
 * relatively. Direction follows the rounded value, so "±0 %" is always flat. Returns null when
 * there is nothing to compare with.
 */
export function buildDelta(input: BuildDeltaInput): ResolvedDelta | null {
  const usePp = input.unit === "pct";
  const raw = usePp ? input.deltaPp : input.deltaPct;
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  const decimals = input.decimals ?? (usePp ? 1 : 0);
  const formatted = usePp ? formatDeltaPp(raw, decimals) : formatDeltaPercent(raw, decimals);
  // format-sv writes "±0 %" exactly when the value rounds to zero.
  const direction: Direction = formatted.startsWith("±") ? "flat" : raw > 0 ? "up" : "down";
  const favorable =
    direction === "flat" || input.higherIsBetter === null
      ? null
      : (direction === "up") === input.higherIsBetter;
  return { direction, formatted, favorable, againstLabel: input.againstLabel };
}

export type DeltaTone = "favorable" | "unfavorable" | "neutral";

export function deltaTone(favorable: boolean | null): DeltaTone {
  if (favorable === null) return "neutral";
  return favorable ? "favorable" : "unfavorable";
}

const SPOKEN_UNITS: [RegExp, string][] = [
  [/\s*%$/, " procent"],
  [/\s*p\.e\.$/, " procentenheter"],
  [/\s*mkr$/, " miljoner kronor"],
  [/\s*tkr$/, " tusen kronor"],
  [/\s*kr$/, " kronor"],
  [/\s*h$/, " timmar"],
  [/\s*mån$/, " månader"],
  [/\s*st$/, " stycken"],
];

/** "+12 %" -> "12 procent", "−1,3 p.e." -> "1,3 procentenheter". */
function spokenMagnitude(formatted: string): string {
  let text = formatted
    .replace(/ /g, " ")
    .replace(/^[+±−-]/, "")
    .trim();
  for (const [pattern, spoken] of SPOKEN_UNITS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, spoken);
      break;
    }
  }
  return text;
}

/** Screen reader text, e.g. "Ökning 12 procent mot aug 2026". */
export function deltaAriaLabel(delta: Pick<DeltaLike, "direction" | "formatted" | "againstLabel">) {
  const against = delta.againstLabel.trim();
  const suffix = against ? ` ${against}` : "";
  if (delta.formatted.trim() === MISSING || delta.formatted.trim() === "") {
    return `Förändring saknas${suffix}`;
  }
  if (delta.direction === "flat") return `Oförändrat${suffix}`;
  const word = delta.direction === "up" ? "Ökning" : "Minskning";
  return `${word} ${spokenMagnitude(delta.formatted)}${suffix}`;
}
