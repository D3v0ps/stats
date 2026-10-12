import { Archive, ChevronRight, FileText, Pencil, Presentation } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/brand/EmptyState";
import { Heading } from "@/components/brand/Heading";
import { Section } from "@/components/brand/Section";
import { CreateTemplateButton } from "@/components/reports/CreateTemplateButton";
import { FormMessage } from "@/components/reports/FormMessage";
import { FreezeDialog } from "@/components/reports/FreezeDialog";
import {
  attempt,
  freezeDefaults,
  getReportData,
  reportAnchor,
} from "@/components/reports/server-data";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { lastClosedMonth } from "@/lib/core/month";
import { listFrozenReports, listReportTemplates } from "@/lib/db/repo";
import { requireSession } from "@/lib/db/session";
import { frozenMeta, templateMeta } from "@/lib/present/labels";

export const metadata: Metadata = { title: "Rapporter" };

const CARD = "flex flex-col gap-5 rounded-card bg-card p-5 shadow-soft md:p-6";

export default async function ReportsPage() {
  await requireSession();
  const [data, anchor] = await Promise.all([
    attempt(async () => {
      const { db } = await getReportData();
      const [templates, frozen] = await Promise.all([
        listReportTemplates(db),
        listFrozenReports(db),
      ]);
      return { templates, frozen };
    }, "Rapporterna kunde inte hämtas just nu. Försök igen om en stund."),
    // The freeze dialog defaults to the latest complete month, else the last closed one.
    attempt(() => reportAnchor(null)),
  ]);
  const defaults = freezeDefaults(anchor.ok ? anchor.value : lastClosedMonth(new Date()));

  if (!data.ok) {
    return (
      <>
        <PageHeader title="Rapporter" />
        <FormMessage>{data.error}</FormMessage>
      </>
    );
  }
  const { templates, frozen } = data.value;

  return (
    <>
      <PageHeader
        title="Rapporter"
        description="Styrelserapporten: bygg bilderna, presentera, frys och arkivera."
        actions={
          templates.length > 0 ? <CreateTemplateButton kind="blank" variant="outline" /> : null
        }
      />
      <div className="flex flex-col gap-12 md:gap-16">
        <Section
          title="Rapportmallar"
          description="Mallarna visar alltid de senaste publicerade siffrorna."
        >
          {templates.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="Ingen rapport ännu"
              description="Standardrapporten har nio bilder: resultat, intäkter, deltagare, timmar och konsulter. Du kan ändra allt efteråt."
              action={<CreateTemplateButton kind="standard" />}
            />
          ) : (
            <ul className="grid gap-4 md:gap-6 xl:grid-cols-2">
              {templates.map((t) => (
                <li key={t.id} className={CARD} data-testid="template-card">
                  <div className="flex flex-col gap-1">
                    <Heading level={3} as="h3">
                      {t.name}
                    </Heading>
                    <p className="text-sm text-muted-foreground">
                      {templateMeta(t.slides.length, t.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="lg" className="gap-2">
                      <Link href={`/presentera/${t.id}`} data-testid="present-link">
                        <Presentation aria-hidden="true" />
                        Presentera
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg" className="gap-2">
                      <Link href={`/rapporter/${t.id}`} data-testid="edit-link">
                        <Pencil aria-hidden="true" />
                        Redigera
                      </Link>
                    </Button>
                    <FreezeDialog
                      templateId={t.id}
                      defaultTitle={defaults.defaultTitle}
                      months={defaults.months}
                      defaultMonth={defaults.defaultMonth}
                      blockedReason={
                        t.slides.length === 0 ? "Rapporten har inga bilder att frysa." : null
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Arkiv"
          description="Frysta rapporter är låsta: siffrorna ändras inte när ny data laddas upp."
        >
          {frozen.length === 0 ? (
            <EmptyState
              icon={<Archive />}
              title="Inga frysta rapporter"
              description="Frys rapporten inför ett styrelsemöte, så finns exakt den versionen kvar här."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-card bg-card shadow-soft">
              {frozen.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/rapporter/arkiv/${r.id}`}
                    data-testid="frozen-item"
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-ljusgra-100 focus-visible:bg-ljusgra-100 focus-visible:outline-none md:px-6"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{r.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {frozenMeta(r.frozenAt, r.anchorMonth)}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
