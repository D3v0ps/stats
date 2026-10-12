import { Upload } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/brand/EmptyState";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Ladda upp" };

// Placeholder until the import flow (module F) lands.
export default async function UploadPage() {
  await requireSession();
  return (
    <>
      <PageHeader
        title="Ladda upp"
        description="Exporter från Intelliplan, Workbuster och Fortnox. Filerna läses i webbläsaren och sparas aldrig på servern."
      />
      <EmptyState
        icon={<Upload />}
        title="Kommer snart"
        description="Här laddar du upp månadens filer, granskar siffrorna och publicerar dem."
      />
    </>
  );
}
