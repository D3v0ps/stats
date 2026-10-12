import { FileCog } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/brand/EmptyState";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import { CARD } from "@/components/settings/ui";
import { Button } from "@/components/ui/button";
import { formatDateSv, formatNumber } from "@/lib/core/format-sv";
import { listDatasets } from "@/lib/db/repo/catalog";
import { templateUploadCounts } from "@/lib/db/repo/settings-extra";
import { listTemplates } from "@/lib/db/repo/templates";
import { requireSession } from "@/lib/db/session";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { TEMPLATE_KIND_LABELS, signatureSummary } from "@/lib/settings-ui/template-describe";
import { load } from "../load";

const section = sectionBySlug("importmallar");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function TemplatesSettingsPage() {
  await requireSession();
  const result = await load(async (db) => {
    const [templates, datasets, uses] = await Promise.all([
      listTemplates(db),
      listDatasets(db),
      templateUploadCounts(db),
    ]);
    const datasetNames = new Map(datasets.map((d) => [d.key, d.name]));
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      dataset: datasetNames.get(t.datasetKey) ?? t.datasetKey,
      version: t.version,
      signature: signatureSummary(t.headerSignature),
      updatedAt: t.updatedAt,
      uses: uses[t.id] ?? 0,
    }));
  });

  return (
    <Section
      title={section.label}
      description="En mall sparas första gången en ny sorts fil laddas upp och känns sedan igen automatiskt. Ändras mappningen sparas en ny version; tidigare uppladdningar behåller sin."
    >
      {!result.ok ? (
        <LoadError message={result.error} />
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={<FileCog />}
          title="Inga mallar ännu"
          description="Mallar skapas när du laddar upp en fil och sparar mappningen."
          action={
            <Button asChild variant="outline">
              <Link href="/ladda-upp">Ladda upp en fil</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4" data-testid="template-list">
          {result.data.map((t) => (
            <li key={t.id} className={CARD} data-testid="template-row">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`${section.href}/${t.id}`}
                    className="self-start rounded-md font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {t.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {t.dataset} · {TEMPLATE_KIND_LABELS[t.kind]}
                  </p>
                  <p className="text-xs break-words text-muted-foreground">
                    Rubriker: {t.signature}
                  </p>
                </div>
                <dl className="grid shrink-0 grid-cols-3 gap-4 text-sm md:text-right">
                  <div>
                    <dt className="text-xs text-muted-foreground">Version</dt>
                    <dd className="num">{formatNumber(t.version)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Uppladdningar</dt>
                    <dd className="num">{formatNumber(t.uses)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Ändrad</dt>
                    <dd className="whitespace-nowrap">{formatDateSv(t.updatedAt)}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
