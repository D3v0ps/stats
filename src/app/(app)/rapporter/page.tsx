import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/brand/EmptyState";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Rapporter" };

// Placeholder until report templates, presentation and archive (module I) land.
export default async function ReportsPage() {
  await requireSession();
  return (
    <>
      <PageHeader
        title="Rapporter"
        description="Styrelserapporter: presentera, frys och arkivera."
      />
      <EmptyState
        icon={<FileText />}
        title="Kommer snart"
        description="Här bygger du styrelserapporten och visar den i presentationsläge."
      />
    </>
  );
}
