import { ChartNoAxesCombined } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/brand/EmptyState";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Utforska" };

// Placeholder until drill-down and pivot (module H) land.
export default async function ExplorePage() {
  await requireSession();
  return (
    <>
      <PageHeader
        title="Utforska"
        description="Bryt ner valfritt mått per månad, bolag, verksamhet eller kund."
      />
      <EmptyState
        icon={<ChartNoAxesCombined />}
        title="Kommer snart"
        description="Här kommer du kunna gräva i siffrorna bakom översikten."
      />
    </>
  );
}
