import "server-only";

import { closeSync, existsSync, openSync, readSync } from "node:fs";
import path from "node:path";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { readPngSize } from "./png-size";

export type LogoVariant = "white" | "dark";
export type LogoSize = "sm" | "md" | "lg";

/** Official logo files, dropped into public/brand/ by Karim (not committed by default). */
export const LOGO_FILES: Record<LogoVariant, string> = {
  white: "Logo_WHITE-PRIMARY_MB-Miljonbemanning_2024.png",
  dark: "Logo_DARK-PRIMARY_MB-Miljonbemanning_2024.png",
};

export interface LogoAsset {
  src: string;
  width: number;
  height: number;
}

const cache = new Map<string, LogoAsset | null>();

/** The logo file for a variant with its intrinsic size, or null when it is not deployed. */
export function findLogoAsset(
  variant: LogoVariant,
  publicDir = path.join(process.cwd(), "public"),
): LogoAsset | null {
  const file = path.join(publicDir, "brand", LOGO_FILES[variant]);
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  let asset: LogoAsset | null = null;
  if (existsSync(file)) {
    const header = new Uint8Array(24);
    const fd = openSync(file, "r");
    try {
      readSync(fd, header, 0, header.length, 0);
    } finally {
      closeSync(fd);
    }
    const size = readPngSize(header);
    if (size) asset = { src: `/brand/${LOGO_FILES[variant]}`, ...size };
  }
  cache.set(file, asset);
  return asset;
}

const IMAGE_HEIGHT: Record<LogoSize, number> = { sm: 28, md: 40, lg: 64 };
const MARK_CLASS: Record<LogoSize, string> = { sm: "text-xl", md: "text-3xl", lg: "text-5xl" };
const WORD_CLASS: Record<LogoSize, string> = {
  sm: "text-[0.5rem]",
  md: "text-[0.625rem]",
  lg: "text-xs",
};

export interface LogoProps {
  /** "white" on antracit (sidebar, login, presentation), "dark" on light backgrounds. */
  variant?: LogoVariant;
  size?: LogoSize;
  /** Load eagerly (above the fold, e.g. the login screen). */
  eager?: boolean;
  className?: string;
}

/**
 * The MB logo. Uses the official PNG when it exists in public/brand/ (never recoloured or
 * filtered); otherwise a typographic stand-in: "MB." with the red dot over "MILJONBEMANNING".
 */
export function Logo({ variant = "dark", size = "md", eager = false, className }: LogoProps) {
  const asset = findLogoAsset(variant);
  if (asset) {
    const height = IMAGE_HEIGHT[size];
    const width = Math.round((asset.width * height) / asset.height);
    return (
      <Image
        src={asset.src}
        alt="Miljonbemanning"
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        className={cn("block", className)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label="Miljonbemanning"
      data-slot="logo"
      className={cn(
        "inline-flex flex-col items-start leading-none select-none",
        variant === "white" ? "text-white" : "text-antracit",
        className,
      )}
    >
      <span className={cn("font-extrabold tracking-tight", MARK_CLASS[size])}>
        MB<span className="text-rod">.</span>
      </span>
      <span className={cn("mt-1 font-semibold tracking-[0.32em] uppercase", WORD_CLASS[size])}>
        Miljonbemanning
      </span>
    </span>
  );
}
