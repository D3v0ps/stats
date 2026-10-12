import type { Metadata } from "next";
import { Section } from "@/components/brand/Section";
import { CompaniesEditor } from "@/components/settings/CompaniesEditor";
import { LoadError } from "@/components/settings/LoadError";
import { listCompanies } from "@/lib/db/repo/catalog";
import { requireSession } from "@/lib/db/session";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { load } from "../load";

const section = sectionBySlug("bolag");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function CompaniesSettingsPage() {
  await requireSession();
  const result = await load(listCompanies);
  return (
    <Section
      title={section.label}
      description="Organisationsnumren kan inte ändras här – de används för att känna igen bolagets bokföringsfiler. Räkenskapsåret styr ”Hittills i år” och kvartalen i översikten och rapporterna."
    >
      {result.ok ? (
        <CompaniesEditor
          companies={result.data.map((c) => ({
            code: c.code,
            legalName: c.legalName,
            shortName: c.shortName,
            orgNr: c.orgNr,
            fiscalStartMonth: c.fiscalStartMonth,
          }))}
        />
      ) : (
        <LoadError message={result.error} />
      )}
    </Section>
  );
}
