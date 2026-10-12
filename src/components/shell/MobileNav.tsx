"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavLinks } from "./NavLinks";

const ICON_BUTTON = "text-white hover:bg-white/10 hover:text-white focus-visible:ring-sidebar-ring";

/**
 * Top bar with a menu sheet for small screens (below `lg`). The logo and the logout control
 * are rendered on the server and passed in.
 */
export function MobileNav({ logo, logout }: { logo: ReactNode; logout: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-sidebar px-4 text-sidebar-foreground lg:hidden">
      <Link
        href="/"
        aria-label="Till översikten"
        className="rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      >
        {logo}
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-lg" aria-label="Öppna menyn" className={ICON_BUTTON}>
            <Menu aria-hidden="true" className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          showCloseButton={false}
          aria-describedby={undefined}
          className="w-72 gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="flex-row items-center justify-between px-6 pt-6 pb-8">
            <SheetTitle className="sr-only">Meny</SheetTitle>
            {logo}
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Stäng menyn" className={ICON_BUTTON}>
                <X aria-hidden="true" className="size-5" />
              </Button>
            </SheetClose>
          </SheetHeader>
          <nav aria-label="Huvudmeny" className="px-3">
            <NavLinks onNavigate={() => setOpen(false)} />
          </nav>
          <SheetFooter className="border-t border-sidebar-border px-3 py-4">{logout}</SheetFooter>
        </SheetContent>
      </Sheet>
    </header>
  );
}
