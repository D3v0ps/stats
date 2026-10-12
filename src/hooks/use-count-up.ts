"use client";

import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from "react";
import { COUNT_UP_DURATION_MS, countUpFrame, shouldAnimateCountUp } from "./count-up";
import { REDUCED_MOTION_QUERY } from "./use-media-query";

export interface CountUpOptions {
  durationMs?: number;
  /** Never animate (frozen reports, PDF, notes window). */
  static?: boolean;
}

/**
 * Counts the text of the returned element up from 0 to `target`, once per mount.
 *
 * The element must render `format(target)` as its only child. That text is what the server
 * sends and where the animation ends, so print, no-JS and frozen views always show the real
 * number, never a zero. Frames are written straight to the DOM (no React render per frame).
 * Skipped for reduced motion, the `static` option and any `[data-static]` ancestor.
 */
export function useCountUp<T extends HTMLElement>(
  target: number,
  format: (value: number) => string,
  options: CountUpOptions = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const started = useRef(false);
  const durationMs = options.durationMs ?? COUNT_UP_DURATION_MS;
  const isStatic = options.static ?? false;
  const formatFrame = useEffectEvent(format);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || started.current) return;
    const animate = shouldAnimateCountUp({
      isStatic,
      hasStaticAncestor: el.closest("[data-static]") !== null,
      reducedMotion: window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
      target,
    });
    if (!animate) return;

    started.current = true;
    const finalText = el.textContent ?? "";
    let lastWritten = "";
    let raf = 0;
    let startedAt: number | null = null;
    const write = (text: string) => {
      lastWritten = text;
      el.textContent = text;
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeprint", finish);
      write(finalText);
    };
    const tick = (now: number) => {
      startedAt ??= now;
      const progress = (now - startedAt) / durationMs;
      if (progress >= 1) {
        finish();
        return;
      }
      write(formatFrame(countUpFrame(target, progress)));
      raf = requestAnimationFrame(tick);
    };

    // Runs before paint, so client-side navigations never flash the final value first.
    write(formatFrame(0));
    raf = requestAnimationFrame(tick);
    window.addEventListener("beforeprint", finish);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeprint", finish);
      // React replaced the text (new target): keep it and do not animate again. Otherwise the
      // run was interrupted (unmount, Strict Mode replay): restore the real number and allow
      // a fresh run.
      if (el.textContent === lastWritten && lastWritten !== finalText) {
        el.textContent = finalText;
        started.current = false;
      }
    };
  }, [target, durationMs, isStatic]);

  return ref;
}
