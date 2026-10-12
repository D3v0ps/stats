import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { requireSession } from "@/lib/db/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <>
      <AppShell>{children}</AppShell>
      {/* The one toaster of the signed-in app (light only: the app has no dark theme). */}
      <Toaster theme="light" position="bottom-right" />
    </>
  );
}
