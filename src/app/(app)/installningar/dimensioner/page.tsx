import { ChevronRight, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import {
  listAliases,
  listDatasets,
  listDimensionValues,
  listDimensions,
} from "@/lib/db/repo/catalog";
import { requireSession } from "@/lib/db/session";
import {
  PERSONAL_NOTICE,
  POLICY_LABELS,
  aliasCountLabel,
  valueCountLabel,
} from "@/lib/settings-ui/dimensions";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { load } from "../load";

const section = sectionBySlug("dimensioner");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function DimensionsSettingsPage() {
  await requireSession();
  const result = await load(async (db) => {
    const [dimensions, datasets, values, aliases] = await Promise.all([
      listDimensions(db),
      listDatasets(db),
      listDimensionValues(db),
      listAliases(db),
    ]);
    return dimensions.map((d) => ({
      ...d,
      values: values.filter((v) => v.dimensionKey === d.key).length,
      aliases: aliases.filter((a) => a.dimensionKey === d.key).length,
      datasets: datasets.filter((ds) => ds.dimensions.includes(d.key)).map((ds) => ds.name),
    }));
  });

  return (
    <Section
      title={section.label}
      description="Grupperingarna som siffrorna kan delas upp på. Välj en dimension för att byta namn på värden, slå ihop dubbletter eller lägga till alias (andra stavningar och koder som ska räknas som samma värde)."
    >
      {result.ok ? (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="dimension-list">
          {result.data.map((d) => (
            <li key={d.key}>
              <Link
                href={`${section.href}/${d.key}`}
                data-testid={`dimension-link-${d.key}`}
                className="group flex h-full flex-col gap-3 rounded-card bg-card p-5 shadow-soft transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:p-6"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium tracking-[0.08em] uppercase">{d.label}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-antracit-200 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
                <span className="text-sm">
                  {valueCountLabel(d.values)} · {aliasCountLabel(d.aliases)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {POLICY_LABELS[d.unknownPolicy]}
                </span>
                {d.datasets.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Finns i: {d.datasets.join(", ")}
                  </span>
                ) : null}
                {d.personal ? (
                  <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-rod-100 px-2.5 py-1 text-xs font-medium text-antracit">
                    <ShieldAlert aria-hidden="true" className="size-3.5" />
                    {PERSONAL_NOTICE}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <LoadError message={result.error} />
      )}
    </Section>
  );
}
