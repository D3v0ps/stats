import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/db/session";
import { SETTINGS_SECTIONS } from "@/lib/settings-ui/sections";

export const metadata: Metadata = { title: "Inställningar" };

export default async function SettingsPage() {
  await requireSession();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" data-testid="settings-overview">
      {SETTINGS_SECTIONS.map((s) => (
        <li key={s.slug}>
          <Link
            href={s.href}
            className="group flex h-full items-start justify-between gap-4 rounded-card bg-card p-5 shadow-soft transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:p-6"
          >
            <span className="flex flex-col gap-1.5">
              <span className="text-sm font-medium tracking-[0.08em] uppercase">{s.label}</span>
              <span className="text-sm text-muted-foreground">{s.description}</span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-antracit-200 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
