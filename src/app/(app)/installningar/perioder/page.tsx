import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/brand/EmptyState";
import { Section } from "@/components/brand/Section";
import { LoadError } from "@/components/settings/LoadError";
import { PeriodsTable } from "@/components/settings/PeriodsTable";
import { Notice } from "@/components/settings/ui";
import { Button } from "@/components/ui/button";
import { listCompanies, listDatasets } from "@/lib/db/repo/catalog";
import { listClosedPeriods } from "@/lib/db/repo/settings";
import { listMonthsWithData } from "@/lib/db/repo/settings-extra";
import { requireSession } from "@/lib/db/session";
import { buildPeriodRows } from "@/lib/settings-ui/periods";
import { sectionBySlug } from "@/lib/settings-ui/sections";
import { load } from "../load";

const section = sectionBySlug("perioder");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function PeriodsSettingsPage() {
  await requireSession();
  const result = await load(async (db) => {
    const [withData, closed, datasets, companies] = await Promise.all([
      listMonthsWithData(db),
      listClosedPeriods(db),
      listDatasets(db),
      listCompanies(db),
    ]);
    return {
      rows: buildPeriodRows(
        withData,
        closed,
        Object.fromEntries(datasets.map((d) => [d.key, d.name])),
      ),
      companies: companies.map((c) => ({ code: c.code, shortName: c.shortName })),
    };
  });

  return (
    <Section
      title={section.label}
      description="Månader med publicerad data per bolag. En stängd månad är en markering för er själva: i den här versionen går det fortfarande att ladda upp nya filer för den."
    >
      {!result.ok ? (
        <LoadError message={result.error} />
      ) : result.data.rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="Inga månader med data ännu"
          description="Månaderna visas här när den första filen är publicerad."
          action={
            <Button asChild variant="outline">
              <Link href="/ladda-upp">Ladda upp en fil</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Notice>
            Stäng en månad när siffrorna är klara, till exempel efter styrelsemötet. Markeringen
            syns här och kan tas bort när som helst.
          </Notice>
          <PeriodsTable rows={result.data.rows} companies={result.data.companies} />
        </div>
      )}
    </Section>
  );
}
