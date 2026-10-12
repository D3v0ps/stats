import { History, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/brand/EmptyState";
import { HistoryTable } from "@/components/import/history/HistoryTable";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { listDatasets, listTemplates, listUploads } from "@/lib/db/repo";
import { requireSession } from "@/lib/db/session";
import { actionErrorMessage } from "@/lib/import-ui/errors";
import { historyRows, type HistoryRow } from "@/lib/import-ui/upload-history";

export const metadata: Metadata = { title: "Historik" };

async function loadRows(): Promise<
  { ok: true; rows: HistoryRow[] } | { ok: false; message: string }
> {
  try {
    const db = await createSupabaseServerClient();
    const [uploads, datasets, templates] = await Promise.all([
      listUploads(db, { status: ["published", "retracted"], limit: 300 }),
      listDatasets(db),
      listTemplates(db),
    ]);
    return { ok: true, rows: historyRows(uploads, datasets, templates) };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export default async function UploadHistoryPage() {
  await requireSession();
  const data = await loadRows();
  return (
    <>
      <PageHeader
        title="Historik"
        description="Alla filer som har publicerats. Ingenting raderas: ångrar du en publicering gäller den tidigare versionen igen."
        actions={
          <Button asChild variant="outline">
            <Link href="/ladda-upp">
              <Upload aria-hidden="true" />
              Ladda upp
            </Link>
          </Button>
        }
      />
      {!data.ok ? (
        <EmptyState
          icon={<History />}
          title="Historiken kan inte visas just nu"
          description={data.message}
        />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Inget publicerat ännu"
          description="När du har granskat och publicerat en fil syns den här."
          action={
            <Button asChild>
              <Link href="/ladda-upp">Ladda upp en fil</Link>
            </Button>
          }
        />
      ) : (
        <HistoryTable rows={data.rows} />
      )}
    </>
  );
}
