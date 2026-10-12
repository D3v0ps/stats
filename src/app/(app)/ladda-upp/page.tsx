import { History, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/brand/EmptyState";
import { UploadApp } from "@/components/import/UploadApp";
import type { UploadCatalog } from "@/components/import/types";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import {
  discardStaleUploads,
  listAccountGroups,
  listDatasets,
  listDimensions,
  listMetricDefinitions,
  listTemplates,
  type StoredTemplate,
} from "@/lib/db/repo";
import { requireSession } from "@/lib/db/session";
import { actionErrorMessage } from "@/lib/import-ui/errors";

export const metadata: Metadata = { title: "Ladda upp" };

async function loadCatalog(): Promise<
  { ok: true; catalog: UploadCatalog; templates: StoredTemplate[] } | { ok: false; message: string }
> {
  try {
    const db = await createSupabaseServerClient();
    // Uploads left staged by a closed tab or a lost connection are cleaned up on the way in,
    // alongside the reads (none of them reads staged uploads). Housekeeping only: the page
    // works the same when it fails.
    const cleanup = discardStaleUploads(db).catch(() => undefined);
    const [datasets, metrics, dimensions, templates, accountGroups] = await Promise.all([
      listDatasets(db),
      listMetricDefinitions(db),
      listDimensions(db),
      listTemplates(db),
      listAccountGroups(db),
    ]);
    await cleanup;
    return {
      ok: true,
      catalog: {
        datasets: datasets.map((d) => ({
          key: d.key,
          name: d.name,
          kind: d.kind,
          dimensions: d.dimensions,
        })),
        metrics: metrics
          .filter((m) => m.kind !== "formula")
          .map((m) => ({
            key: m.key,
            name: m.name,
            unit: m.unit,
            kind: m.kind,
            datasetKey: m.datasetKey,
            higherIsBetter: m.higherIsBetter,
            decimals: m.decimals,
          })),
        dimensions: dimensions.map((d) => ({ key: d.key, label: d.label, personal: d.personal })),
        accountGroups: accountGroups.map((g) => ({
          key: g.key,
          name: g.name,
          sign: g.sign,
          ranges: g.ranges,
        })),
      },
      templates,
    };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export default async function UploadPage() {
  await requireSession();
  const data = await loadCatalog();
  return (
    <>
      <PageHeader
        title="Ladda upp"
        description="Släpp månadens exporter från Intelliplan, Workbuster och Fortnox. Filerna läses i webbläsaren och sparas aldrig på servern – bara siffrorna du godkänner."
        actions={
          <Button asChild variant="outline" data-testid="history-link">
            <Link href="/ladda-upp/historik">
              <History aria-hidden="true" />
              Historik
            </Link>
          </Button>
        }
      />
      {data.ok ? (
        <UploadApp catalog={data.catalog} templates={data.templates} />
      ) : (
        <EmptyState
          icon={<Upload />}
          title="Uppladdningen kan inte visas just nu"
          description={data.message}
        />
      )}
    </>
  );
}
