// Pure maths and policy behind useCountUp (kept apart so it can be unit tested).

export const COUNT_UP_DURATION_MS = 900;

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/**
 * The value to show at `progress` (0..1) of the animation from `from` (default 0) to
 * `target`. Between integers only integers are shown so counts never flash decimals; the
 * end is always exactly `target`.
 */
export function countUpFrame(target: number, progress: number, from = 0): number {
  if (progress >= 1 || !Number.isFinite(target) || !Number.isFinite(from)) return target;
  const value = from + (target - from) * easeOutCubic(progress);
  return Number.isInteger(target) && Number.isInteger(from) ? Math.round(value) : value;
}

export interface CountUpStartInput {
  /** The value the element settled on last time; null before the first run. */
  previous: number | null;
  /** The element came from server HTML (hydration), so its number is already on screen. */
  hydrated: boolean;
  target: number;
}

/**
 * Where an animation towards `target` starts, or null for none. The first run after
 * hydration never animates: the server already painted the real number and counting from
 * 0 would make the first paint after hydration smaller than the server's. A fresh mount on
 * the client (navigation) counts up from 0 before its first paint. Later value changes
 * count from the previous value.
 */
export function countUpStart({ previous, hydrated, target }: CountUpStartInput): number | null {
  if (previous === null) return hydrated ? null : 0;
  return previous === target ? null : previous;
}

export interface CountUpPolicyInput {
  /** The component was told to be static (frozen report, PDF, notes window). */
  isStatic: boolean;
  /** An ancestor carries data-static. */
  hasStaticAncestor: boolean;
  reducedMotion: boolean;
  target: number;
  /** Start value of the animation (default 0). */
  from?: number;
}

/**
 * Animate only when nothing asks for a still picture and there is a distance to cover
 * (counting from 0 to 0 shows nothing); non-finite values are shown as they are.
 */
export function shouldAnimateCountUp(input: CountUpPolicyInput): boolean {
  if (input.isStatic || input.hasStaticAncestor || input.reducedMotion) return false;
  const from = input.from ?? 0;
  return Number.isFinite(input.target) && Number.isFinite(from) && input.target !== from;
}
