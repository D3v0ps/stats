import type { ResolvedSlide } from "@/lib/contracts/slides";
import { cn } from "@/lib/utils";
import { Slide } from "./Slide";

export interface SlideFrameProps {
  slide: ResolvedSlide;
  index?: number;
  count?: number;
  className?: string;
}

/**
 * A 16:9 miniature of a deck slide (editor preview, archive thumbnails) in the presentation
 * theme. Typography scales with the frame (container units); charts keep their real size,
 * since a scaled-down chart would clip its axis labels.
 */
export function SlideFrame({ slide, index, count, className }: SlideFrameProps) {
  return (
    <div
      data-static=""
      className={cn(
        "theme-present relative aspect-video w-full overflow-hidden rounded-card shadow-soft",
        className,
      )}
    >
      <Slide slide={slide} index={index} count={count} fit="exact" />
    </div>
  );
}
