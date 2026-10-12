"use client";

import { useEffect, useState } from "react";
import { previewSlideAction } from "@/app/(app)/rapporter/actions";
import type { ResolvedSlide, SlideSpec } from "@/lib/contracts/slides";
import { previewRequest } from "@/lib/present/editor-options";

/** Wait this long after the last change before asking the server (typing in fields). */
const PREVIEW_DELAY_MS = 350;

interface PreviewResult {
  key: string;
  slide: ResolvedSlide | null;
  error: string | null;
}

/**
 * The selected slide resolved on the server for the anchor month. Notes and headline edits
 * never refetch (they do not change numbers); the last result stays visible while the next
 * one loads, as long as it belongs to the same slide.
 */
export function useSlidePreview(slide: SlideSpec | null, anchor: string) {
  const request = slide ? previewRequest(slide) : null;
  const key = request ? JSON.stringify(request) : "";
  const [result, setResult] = useState<PreviewResult | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    // The effect depends on the serialized request only, so a re-render with an equal spec
    // (e.g. a notes edit) never refetches.
    const spec = JSON.parse(key) as SlideSpec;
    const timer = setTimeout(() => {
      previewSlideAction(spec, anchor).then(
        (r) => {
          if (cancelled) return;
          setResult(
            r.ok ? { key, slide: r.data, error: null } : { key, slide: null, error: r.error },
          );
        },
        () => {
          if (!cancelled) {
            setResult({ key, slide: null, error: "Förhandsvisningen kunde inte tas fram." });
          }
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, anchor]);

  const sameSlide = result !== null && slide !== null && (result.slide?.id ?? null) === slide.id;
  return {
    resolved: sameSlide || result?.key === key ? (result?.slide ?? null) : null,
    error: result?.key === key ? (result?.error ?? null) : null,
    pending: key !== "" && result?.key !== key,
  };
}
