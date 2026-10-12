import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { LogoutButton } from "./LogoutButton";
import { MobileNav } from "./MobileNav";
import { NavLinks } from "./NavLinks";

/**
 * Antracit sidebar (white logo, main navigation, logout) on large screens; a top bar with a menu
 * sheet below `lg`. Content gets airy padding and a readable maximum width.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#innehall"
        className="sr-only z-50 rounded-md bg-white px-4 py-2 text-sm text-antracit focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Hoppa till innehållet
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="px-7 pt-9 pb-12">
          <Link
            href="/"
            aria-label="Till översikten"
            className="inline-block rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            <Logo variant="white" size="md" />
          </Link>
        </div>
        <nav aria-label="Huvudmeny" className="flex-1 overflow-y-auto px-4">
          <NavLinks />
        </nav>
        <div className="border-t border-sidebar-border px-4 py-5">
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav logo={<Logo variant="white" size="sm" />} logout={<LogoutButton />} />
        <main
          id="innehall"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 outline-none sm:px-6 md:px-10 md:py-12 xl:px-14"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
