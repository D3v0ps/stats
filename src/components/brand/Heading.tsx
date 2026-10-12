import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HeadingLevel = 1 | 2 | 3 | 4;
export type HeadingAccent = "none" | "dot" | "underscore";

const LEVEL_CLASS: Record<HeadingLevel, string> = {
  1: "text-3xl md:text-4xl font-light",
  2: "text-xl md:text-2xl font-light",
  3: "text-base md:text-lg font-normal",
  4: "text-xs font-medium",
};

const TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" } as const;

export interface HeadingProps extends Omit<ComponentPropsWithoutRef<"h2">, "children"> {
  level?: HeadingLevel;
  /** Render as another element while keeping the level's look (e.g. a styled <p>). */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div";
  /** "dot": red full stop ("RESULTAT."), "underscore": short red bar under the heading. */
  accent?: HeadingAccent;
  children: ReactNode;
}

/** Brand heading: uppercase, airy letter spacing, light weight. */
export function Heading({
  level = 2,
  as,
  accent = "none",
  className,
  children,
  ...props
}: HeadingProps) {
  const Tag = as ?? TAGS[level];
  return (
    <Tag
      data-slot="heading"
      className={cn(
        "leading-tight tracking-[0.08em] text-balance uppercase",
        LEVEL_CLASS[level],
        accent === "underscore" &&
          "after:mt-2 after:block after:h-[3px] after:w-10 after:bg-rod after:content-['']",
        className,
      )}
      {...props}
    >
      {accent === "dot" ? withRedDot(children) : children}
    </Tag>
  );
}

/** Colour a trailing full stop red, or add one ("DELTAGARNA ÖKAR." keeps a single dot). */
function withRedDot(children: ReactNode): ReactNode {
  const dot = (
    <span className="text-rod" aria-hidden="true">
      .
    </span>
  );
  if (typeof children === "string" && children.trimEnd().endsWith(".")) {
    return (
      <>
        {children.trimEnd().slice(0, -1)}
        {dot}
      </>
    );
  }
  return (
    <>
      {children}
      {dot}
    </>
  );
}
