import type { Metadata } from "next";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import { AccountGroupsEditor } from "@/components/settings/AccountGroupsEditor";
import { listAccountGroups, listMetricDefinitions } from "@/lib/db/repo/catalog";
import { requireSession } from "@/lib/db/session";
import { ledgerMetricsByGroup } from "@/lib/settings-ui/account-groups";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { load } from "../load";

const section = sectionBySlug("kontogrupper");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function AccountGroupsSettingsPage() {
  await requireSession();
  const result = await load(async (db) => {
    const [groups, definitions] = await Promise.all([
      listAccountGroups(db),
      listMetricDefinitions(db),
    ]);
    return { groups, usedBy: ledgerMetricsByGroup(definitions) };
  });
  return (
    <Section
      title={section.label}
      description="Kontogrupperna avgör vilka konton i bokföringen (SIE) som räknas till intäkter, kostnader och resultat. Kontonummer enligt BAS, fyra siffror."
    >
      {result.ok ? <AccountGroupsEditor {...result.data} /> : <LoadError message={result.error} />}
    </Section>
  );
}
