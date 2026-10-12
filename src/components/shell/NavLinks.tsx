"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, NAV_ROW, isNavItemActive } from "./nav-items";

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isNavItemActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(NAV_ROW, active && "font-medium text-white")}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="relative">
                {label}
                {active ? (
                  <span
                    aria-hidden="true"
                    data-slot="nav-underscore"
                    className="absolute -bottom-1.5 left-0 h-0.5 w-full rounded-full bg-rod"
                  />
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
