"use client";

import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { COUNT_UP_DURATION_MS, countUpFrame, countUpStart, shouldAnimateCountUp } from "./count-up";
import { REDUCED_MOTION_QUERY } from "./use-media-query";

export interface CountUpOptions {
  durationMs?: number;
  /** Never animate (frozen reports, PDF, notes window). */
  static?: boolean;
}

const subscribeNothing = () => () => {};

/** True while React hydrates server HTML (it renders with the server snapshot), else false. */
function useIsHydrating(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => false,
    () => true,
  );
}

/**
 * Animates the text of the returned element towards `target`.
 *
 * The element must render `format(target)` as its only child. That text is what the server
 * sends and where every animation ends, so print, no-JS and frozen views always show the real
 * number. When the element was hydrated from server HTML the number is already on screen and
 * the first run does not animate (the first paint after hydration never shows less than the
 * server did). A mount on the client (navigation) counts up from 0 before its first paint, and
 * a later change of `target` counts from the number on screen. Frames are written straight to
 * the DOM (no React render per frame). Skipped for reduced motion, the `static` option and any
 * `[data-static]` ancestor.
 */
export function useCountUp<T extends HTMLElement>(
  target: number,
  format: (value: number) => string,
  options: CountUpOptions = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const hydrating = useIsHydrating();
  // The first render decides: hydration renders with the server snapshot.
  const hydrated = useRef(hydrating);
  // The value the element settled on (null before the first run).
  const settled = useRef<number | null>(null);
  const durationMs = options.durationMs ?? COUNT_UP_DURATION_MS;
  const isStatic = options.static ?? false;
  const formatFrame = useEffectEvent(format);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = countUpStart({ previous: settled.current, hydrated: hydrated.current, target });
    settled.current = target;
    if (from === null) return;
    const animate = shouldAnimateCountUp({
      isStatic,
      hasStaticAncestor: el.closest("[data-static]") !== null,
      reducedMotion: window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
      target,
      from,
    });
    if (!animate) return;

    const finalText = el.textContent ?? "";
    let shown = from;
    let lastWritten = "";
    let done = false;
    let raf = 0;
    let startedAt: number | null = null;
    const write = (value: number) => {
      shown = value;
      lastWritten = formatFrame(value);
      el.textContent = lastWritten;
    };
    const finish = () => {
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeprint", finish);
      el.textContent = finalText;
    };
    const tick = (now: number) => {
      startedAt ??= now;
      const progress = (now - startedAt) / durationMs;
      if (progress >= 1) {
        finish();
        return;
      }
      write(countUpFrame(target, progress, from));
      raf = requestAnimationFrame(tick);
    };

    // Runs before paint, so a client-side mount never flashes the final value first.
    write(from);
    raf = requestAnimationFrame(tick);
    window.addEventListener("beforeprint", finish);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeprint", finish);
      if (done) return;
      // Interrupted (new target, unmount, Strict Mode replay): a next run continues from the
      // number on screen. If React did not replace the text, put the real number back.
      settled.current = shown;
      if (el.textContent === lastWritten) el.textContent = finalText;
    };
  }, [target, durationMs, isStatic]);

  return ref;
}
