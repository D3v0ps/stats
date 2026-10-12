import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { PageHeader } from "@/components/shell/PageHeader";
import { Toaster } from "@/components/ui/sonner";
import { requireSession } from "@/lib/db/session";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <>
      <PageHeader
        title="Inställningar"
        description="Katalogen bakom siffrorna, importmallar, perioder och säkerhet. Ändringar gäller direkt för alla."
      />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-12">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
      {/* The app layout has no toaster yet; settings mounts its own (light: no dark theme). */}
      <Toaster theme="light" position="bottom-right" />
    </>
  );
}
