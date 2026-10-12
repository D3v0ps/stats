import type { Metadata } from "next";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import { ThresholdForm } from "@/components/settings/ThresholdForm";
import { SETTING_DEFAULTS, getSettings } from "@/lib/db/repo/settings";
import { requireSession } from "@/lib/db/session";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { load } from "../load";

const section = sectionBySlug("granskning");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function ReviewSettingsPage() {
  await requireSession();
  const result = await load(getSettings);
  return (
    <Section title={section.label} description={section.description}>
      {result.ok ? (
        <ThresholdForm
          key={result.data.deviationThresholdPct}
          value={result.data.deviationThresholdPct}
          defaultValue={SETTING_DEFAULTS.deviationThresholdPct}
        />
      ) : (
        <LoadError message={result.error} />
      )}
    </Section>
  );
}
