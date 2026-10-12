import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FormMessage } from "@/components/reports/FormMessage";
import {
  attempt,
  freezeDefaults,
  getReportData,
  reportAnchor,
} from "@/components/reports/server-data";
import { TemplateEditor } from "@/components/reports/TemplateEditor";
import { PageHeader } from "@/components/shell/PageHeader";
import { getReportTemplate } from "@/lib/db/repo";
import { listReportFilterValues } from "@/lib/db/repo/present-extra";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Redigera rapport" };

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();

  const loaded = await attempt(async () => {
    const { db, definitions, dimensions } = await getReportData();
    const template = await getReportTemplate(db, id);
    if (!template) return null;
    const [filterValues, anchor] = await Promise.all([
      listReportFilterValues(db, dimensions),
      reportAnchor(null),
    ]);
    return { template, definitions, dimensions, filterValues, anchor };
  }, "Rapporten kunde inte hämtas just nu. Försök igen om en stund.");
  if (loaded.ok && loaded.value === null) notFound();
  if (!loaded.ok || loaded.value === null) {
    return (
      <>
        <PageHeader title="Rapport" />
        <FormMessage>{loaded.ok ? "Rapporten finns inte." : loaded.error}</FormMessage>
      </>
    );
  }

  const { template, definitions, dimensions, filterValues, anchor } = loaded.value;
  return (
    <>
      <PageHeader
        title={template.name}
        description={
          <>
            Bygg bilderna: ett budskap och ett diagram per bild.{" "}
            <Link href="/rapporter" className="underline underline-offset-4">
              Alla rapporter
            </Link>
          </>
        }
      />
      <TemplateEditor
        templateId={template.id}
        initialName={template.name}
        initialSlides={template.slides}
        metrics={definitions.map((d) => ({
          key: d.key,
          name: d.name,
          unit: d.unit,
          dimensions: d.dimensions,
        }))}
        dimensions={dimensions.map((d) => ({ key: d.key, label: d.label, personal: d.personal }))}
        filterValues={filterValues}
        anchor={anchor}
        freeze={freezeDefaults(anchor)}
      />
    </>
  );
}
