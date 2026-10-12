"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SECTIONS, activeSection } from "@/lib/settings-ui/sections";
import { cn } from "@/lib/utils";

/**
 * Settings sub-navigation: a vertical list beside the content on large screens, a horizontally
 * scrolling row of pills on small ones.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const active = activeSection(pathname);
  return (
    <nav aria-label="Inställningar" className="-mx-4 min-w-0 sm:mx-0">
      <ul className="flex gap-2 overflow-x-auto px-4 pb-1 sm:px-0 lg:sticky lg:top-8 lg:flex-col lg:gap-1 lg:overflow-visible">
        {SETTINGS_SECTIONS.map((s) => {
          const current = active?.slug === s.slug;
          return (
            <li key={s.slug} className="shrink-0">
              <Link
                href={s.href}
                aria-current={current ? "page" : undefined}
                data-testid={`settings-nav-${s.slug}`}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:rounded-lg lg:px-3",
                  current
                    ? "bg-antracit font-medium text-white lg:bg-card lg:text-foreground lg:shadow-soft"
                    : "bg-card text-antracit-300 hover:text-foreground lg:bg-transparent lg:hover:bg-card",
                )}
              >
                {current ? (
                  <span
                    aria-hidden="true"
                    className="hidden h-4 w-0.5 rounded-full bg-rod lg:inline-block"
                  />
                ) : null}
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
