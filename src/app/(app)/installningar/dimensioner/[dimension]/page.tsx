import { ChevronLeft, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import { AliasImportPanel } from "@/components/settings/dimensions/AliasImportPanel";
import { DimensionValuesEditor } from "@/components/settings/dimensions/DimensionValuesEditor";
import { DimensionKeySchema } from "@/lib/contracts/domain";
import {
  listAliases,
  listDatasets,
  listDimensionValues,
  listDimensions,
} from "@/lib/db/repo/catalog";
import { requireSession } from "@/lib/db/session";
import { PERSONAL_NOTICE, POLICY_LABELS, buildValueRows } from "@/lib/settings-ui/dimensions";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { load } from "../../load";

const section = sectionBySlug("dimensioner");

interface PageProps {
  params: Promise<{ dimension: string }>;
}

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function DimensionValuesPage({ params }: PageProps) {
  await requireSession();
  const { dimension: key } = await params;
  if (!DimensionKeySchema.safeParse(key).success) notFound();

  const result = await load(async (db) => {
    const dimension = (await listDimensions(db)).find((d) => d.key === key);
    if (!dimension) return null;
    const [values, aliases, datasets] = await Promise.all([
      listDimensionValues(db, { dimensionKey: key, includeInactive: true }),
      listAliases(db, key),
      listDatasets(db),
    ]);
    return {
      dimension,
      rows: buildValueRows(values, aliases),
      datasets: datasets.filter((d) => d.dimensions.includes(key)).map((d) => d.name),
    };
  });
  if (result.ok && result.data === null) notFound();

  const back = (
    <Link
      href={section.href}
      className="inline-flex items-center gap-1 self-start rounded-md text-sm text-antracit-300 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Alla dimensioner
    </Link>
  );

  if (!result.ok || result.data === null) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <LoadError message={result.ok ? "Dimensionen finns inte." : result.error} />
      </div>
    );
  }

  const { dimension, rows, datasets } = result.data;
  return (
    <div className="flex flex-col gap-6">
      {back}
      <Section
        title={dimension.label}
        description={
          <span className="flex flex-col gap-1">
            <span>{POLICY_LABELS[dimension.unknownPolicy]}.</span>
            {datasets.length > 0 ? <span>Finns i: {datasets.join(", ")}.</span> : null}
          </span>
        }
        actions={
          dimension.personal ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rod-100 px-3 py-1.5 text-xs font-medium text-antracit">
              <ShieldAlert aria-hidden="true" className="size-3.5" />
              {PERSONAL_NOTICE}
            </span>
          ) : null
        }
      >
        <DimensionValuesEditor
          dimension={{ key: dimension.key, label: dimension.label, personal: dimension.personal }}
          rows={rows}
        />
      </Section>
      <AliasImportPanel
        dimension={{
          key: dimension.key,
          label: dimension.label,
          personal: dimension.personal,
          policy: dimension.unknownPolicy,
        }}
        rows={rows}
      />
    </div>
  );
}
