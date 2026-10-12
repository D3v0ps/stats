// Pure maths and policy behind useCountUp (kept apart so it can be unit tested).

export const COUNT_UP_DURATION_MS = 900;

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/**
 * The value to show at `progress` (0..1) of the animation from 0 to `target`. Integer targets
 * only show integers so counts never flash decimals; the end is always exactly `target`.
 */
export function countUpFrame(target: number, progress: number): number {
  if (progress >= 1 || !Number.isFinite(target)) return target;
  const value = target * easeOutCubic(progress);
  return Number.isInteger(target) ? Math.round(value) : value;
}

export interface CountUpPolicyInput {
  /** The component was told to be static (frozen report, PDF, notes window). */
  isStatic: boolean;
  /** An ancestor carries data-static. */
  hasStaticAncestor: boolean;
  reducedMotion: boolean;
  target: number;
}

/**
 * Animate only when nothing asks for a still picture. Zero has nothing to count and
 * non-finite values are shown as they are.
 */
export function shouldAnimateCountUp(input: CountUpPolicyInput): boolean {
  if (input.isStatic || input.hasStaticAncestor || input.reducedMotion) return false;
  return Number.isFinite(input.target) && input.target !== 0;
}
