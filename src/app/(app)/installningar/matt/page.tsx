import type { Metadata } from "next";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import { MetricsEditor } from "@/components/settings/metrics/MetricsEditor";
import { listDatasets, listDimensions, listMetricDefinitions } from "@/lib/db/repo/catalog";
import { requireSession } from "@/lib/db/session";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { load } from "../load";

const section = sectionBySlug("matt");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function MetricsSettingsPage() {
  await requireSession();
  const result = await load(async (db) => {
    const [definitions, datasets, dimensions] = await Promise.all([
      listMetricDefinitions(db),
      listDatasets(db),
      listDimensions(db),
    ]);
    return {
      definitions,
      datasets: datasets.map((d) => ({ key: d.key, name: d.name })),
      dimensionLabels: Object.fromEntries(dimensions.map((d) => [d.key, d.label])),
    };
  });
  return (
    <Section title={section.label} description={section.description}>
      {result.ok ? <MetricsEditor {...result.data} /> : <LoadError message={result.error} />}
    </Section>
  );
}
