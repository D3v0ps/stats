import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Heading } from "@/components/brand/Heading";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import { TemplateDeleteButton } from "@/components/settings/TemplateDeleteButton";
import { CARD } from "@/components/settings/ui";
import { formatDateSv, formatNumber } from "@/lib/core/format-sv";
import { listDatasets, listDimensions, listMetricDefinitions } from "@/lib/db/repo/catalog";
import { templateUploadCounts } from "@/lib/db/repo/settings-extra";
import { getTemplate, listTemplateVersions } from "@/lib/db/repo/templates";
import { requireSession } from "@/lib/db/session";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { describeTemplate, signatureSummary } from "@/lib/settings-ui/template-describe";
import { cn } from "@/lib/utils";
import { load } from "../../load";

const section = sectionBySlug("importmallar");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}

const VersionSchema = z.coerce.number().int().positive();

export default async function TemplateDetailPage({ params, searchParams }: PageProps) {
  await requireSession();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const rawVersion = (await searchParams).version;
  const parsedVersion = VersionSchema.safeParse(
    Array.isArray(rawVersion) ? rawVersion[0] : rawVersion,
  );
  const version = parsedVersion.success ? parsedVersion.data : undefined;

  const result = await load(async (db) => {
    const template = await getTemplate(db, id, version);
    if (!template) return null;
    const [versions, definitions, dimensions, datasets, uses] = await Promise.all([
      listTemplateVersions(db, id),
      listMetricDefinitions(db),
      listDimensions(db),
      listDatasets(db),
      templateUploadCounts(db),
    ]);
    const current = Math.max(...versions.map((v) => v.version));
    return {
      template,
      current,
      versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt })).reverse(),
      dataset: datasets.find((d) => d.key === template.datasetKey)?.name ?? template.datasetKey,
      uses: uses[id] ?? 0,
      description: describeTemplate(template.config, {
        metricNames: Object.fromEntries(definitions.map((d) => [d.key, d.name])),
        dimensionLabels: Object.fromEntries(dimensions.map((d) => [d.key, d.label])),
      }),
    };
  });
  if (result.ok && result.data === null) notFound();

  const back = (
    <Link
      href={section.href}
      className="inline-flex items-center gap-1 self-start rounded-md text-sm text-antracit-300 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Alla mallar
    </Link>
  );
  if (!result.ok || result.data === null) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <LoadError message={result.ok ? "Mallen finns inte." : result.error} />
      </div>
    );
  }

  const { template, current, versions, dataset, uses, description } = result.data;
  const viewing = template.version;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <Section
        title={template.name}
        description={`${dataset} · ${description.kindLabel}`}
        actions={<TemplateDeleteButton id={template.id} name={template.name} uses={uses} />}
      >
        {/* grid-cols-1: on phones the columns table scrolls in its card, not the page. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex flex-col gap-6">
            <div className={CARD}>
              <Heading level={3} className="mb-1">
                Version {formatNumber(viewing)}
                {viewing === current ? " (aktuell)" : ""}
              </Heading>
              <p className="mb-4 text-xs break-words text-muted-foreground">
                Rubriker i filen: {signatureSummary(template.headerSignature, 12)}
              </p>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="template-settings">
                {description.settings.map((s) => (
                  <div key={s.label}>
                    <dt className="text-xs text-muted-foreground">{s.label}</dt>
                    <dd className="text-sm break-words">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {description.steps.length > 0 ? (
              <div className={CARD}>
                <Heading level={3} className="mb-4">
                  Steg
                </Heading>
                <ol className="flex flex-col gap-3" data-testid="template-steps">
                  {description.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span
                        aria-hidden="true"
                        className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-ljusgra-200 text-xs"
                      >
                        {i + 1}
                      </span>
                      <span className="flex flex-col">
                        <span className="font-medium">{s.label}</span>
                        <span className="break-words text-muted-foreground">{s.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {description.columns.length > 0 ? (
              <div className={CARD}>
                <Heading level={3} className="mb-4">
                  Kolumner
                </Heading>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-sm" data-testid="template-columns">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="pb-2 font-medium">
                          Kolumn
                        </th>
                        <th scope="col" className="pb-2 font-medium">
                          Används som
                        </th>
                        <th scope="col" className="pb-2 font-medium">
                          Typ
                        </th>
                        <th scope="col" className="pb-2 font-medium">
                          Till
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {description.columns.map((c) => (
                        <tr
                          key={c.column}
                          className={cn("border-t align-top", c.removed && "text-muted-foreground")}
                        >
                          <td className="py-2 pr-3 break-words">
                            {c.column}
                            {c.personal ? (
                              <span className="ml-2 rounded-full bg-rod-100 px-2 py-0.5 text-xs text-antracit">
                                Personuppgift
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3">{c.removed ? "Tas inte med" : c.usage}</td>
                          <td className="py-2 pr-3">{c.type}</td>
                          <td className="py-2">{c.target ?? "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>

          <aside className={cn(CARD, "self-start")} aria-labelledby="template-versions">
            <Heading level={3} id="template-versions" className="mb-4">
              Versioner
            </Heading>
            <ol className="flex flex-col gap-1" data-testid="template-versions">
              {versions.map((v) => (
                <li key={v.version}>
                  <Link
                    href={`${section.href}/${template.id}?version=${v.version}`}
                    aria-current={v.version === viewing ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      v.version === viewing ? "bg-ljusgra-100 font-medium" : "hover:bg-ljusgra-100",
                    )}
                  >
                    <span>
                      Version {formatNumber(v.version)}
                      {v.version === current ? " · aktuell" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateSv(v.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              Versioner ändras aldrig. Varje uppladdning pekar på exakt den version den använde.
            </p>
          </aside>
        </div>
      </Section>
    </div>
  );
}
