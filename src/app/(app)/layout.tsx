import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireSession } from "@/lib/db/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <AppShell>{children}</AppShell>;
}
