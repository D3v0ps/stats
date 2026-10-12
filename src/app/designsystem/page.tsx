import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CountUp } from "@/components/brand/CountUp";
import { Delta } from "@/components/brand/Delta";
import { EmptyState } from "@/components/brand/EmptyState";
import { Heading } from "@/components/brand/Heading";
import { KpiCard } from "@/components/brand/KpiCard";
import { Logo } from "@/components/brand/Logo";
import { Section } from "@/components/brand/Section";
import { Sparkline } from "@/components/brand/Sparkline";
import { StatGrid, StatGridItem } from "@/components/brand/StatGrid";
import { MbBarChart, MbDonut, MbLineChart, MbStackedCompanyBar } from "@/components/brand/charts";
import { buildDelta } from "@/components/brand/delta-text";
import { PALETTE, labelColorOn } from "@/components/brand/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatValue } from "@/lib/core/format-sv";
import { requireSession } from "@/lib/db/session";
import {
  barChart,
  donutChart,
  hoursTrend,
  lineChart,
  stackedChart,
  toplistChart,
} from "./sample-data";

export const metadata: Metadata = { title: "Designsystem" };

const FAMILIES = [
  { key: "antracit", name: "Antracit" },
  { key: "rod", name: "Röd" },
  { key: "ljusgra", name: "Ljusgrå" },
  { key: "bla", name: "Blå" },
] as const;

const CARD = "rounded-card bg-card p-5 shadow-soft md:p-6";
const UPDATED = "2026-10-12T08:30:00Z";

const up = buildDelta({
  unit: "h",
  deltaPct: 4.8,
  higherIsBetter: true,
  againstLabel: "mot aug 2026",
});
const sickUp = buildDelta({
  unit: "h",
  deltaPct: 12.3,
  higherIsBetter: false,
  againstLabel: "mot aug 2026",
});
const ppDown = buildDelta({
  unit: "pct",
  deltaPp: -1.3,
  higherIsBetter: true,
  againstLabel: "mot sep 2025",
});
const flat = buildDelta({
  unit: "st",
  deltaPct: 0.3,
  higherIsBetter: null,
  againstLabel: "mot budget",
});

export default async function DesignSystemPage() {
  await requireSession();
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-16 px-4 py-10 sm:px-6 md:px-10 md:py-14">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-4">
          <Logo variant="dark" size="md" />
          <Heading level={1} accent="dot">
            Designsystem
          </Heading>
          <p className="max-w-2xl text-muted-foreground">
            Alla varumärkeskomponenter med påhittade exempeldata, för visuella kontroller.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Till översikten</Link>
        </Button>
      </header>

      <Section
        title="Färger"
        description="Bara varumärkets palett: inget grönt, rött bara för markeringar."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FAMILIES.map(({ key, name }) => {
            const family = PALETTE[key];
            return (
              <div key={key} className={`${CARD} flex flex-col gap-2 p-4 md:p-4`}>
                <p className="text-xs font-medium tracking-[0.08em] uppercase">{name}</p>
                {(
                  [
                    ["", family.base],
                    ["-300", family[300]],
                    ["-200", family[200]],
                    ["-100", family[100]],
                  ] as const
                ).map(([suffix, hex]) => (
                  <div
                    key={hex}
                    className="num flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                    style={{ backgroundColor: hex, color: labelColorOn(hex) }}
                  >
                    <span>
                      {key}
                      {suffix}
                    </span>
                    <span>{hex}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Typografi"
        description="Montserrat. Rubriker i versaler med luftig spärrning."
      >
        <div className={`${CARD} flex flex-col gap-6`}>
          <Heading level={1} accent="dot">
            Resultat
          </Heading>
          <Heading level={2} accent="underscore">
            Deltagarna ökar
          </Heading>
          <Heading level={3}>Fakturerade timmar per kund</Heading>
          <Heading level={4}>Etikett / ögonbryn</Heading>
          <p className="max-w-prose">
            Brödtext i antracit på vitt.{" "}
            <span className="text-muted-foreground">Sekundär text i grått.</span>
          </p>
          <p className="num text-3xl font-light">
            {formatValue(1_234_567, "kr")} · {formatValue(12.5, "pct")} · {formatValue(4711, "h")}
          </p>
        </div>
      </Section>

      <Section
        title="Nyckeltal"
        description="KPI-kort med uppräkning, förändring, trend och tillstånd."
      >
        <StatGrid columns={4}>
          <KpiCard
            title="Fakturerade timmar"
            value={5480}
            unit="h"
            delta={up}
            sparkline={[...hoursTrend]}
            sparklineLabel="Timmar senaste 12 månaderna"
            lastUpdatedAt={UPDATED}
            href="/utforska"
          />
          <KpiCard
            title="Sjuktimmar"
            value={312}
            unit="h"
            delta={sickUp}
            sparkline={[260, 240, 280, 300, 270, 290, 310, 300, 278, 280, 295, 312]}
            lastUpdatedAt={UPDATED}
          />
          <KpiCard
            title="Bruttomarginal"
            value={23.4}
            unit="pct"
            delta={ppDown}
            footnote="2 av 3 mån har data"
            lastUpdatedAt={UPDATED}
          />
          <KpiCard
            title="Fakturerat"
            value={2_410_000}
            unit="kr"
            formatOptions={{ compact: true }}
            delta={flat}
            footnote="Summa bolag (ej eliminerat)"
          />
          <KpiCard
            title="Aktiva deltagare"
            value={null}
            unit="st"
            delta={null}
            footnote="Ingen fil för sep 2026"
          />
          <KpiCard title="Konsulter i arbete" value={0} unit="st" loading />
          <KpiCard
            title="Fryst kort (statiskt)"
            value={186}
            unit="st"
            delta={up}
            sparkline={[120, 140, 150, 160, 172, 186]}
            static
          />
          <StatGridItem>
            <div className={`${CARD} flex h-full flex-col gap-4`}>
              <Heading level={4}>Förändring</Heading>
              <Delta delta={up} />
              <Delta delta={sickUp} />
              <Delta delta={ppDown} />
              <Delta delta={flat} />
              <Delta delta={null} />
            </div>
          </StatGridItem>
        </StatGrid>
      </Section>

      <Section title="Uppräkning och trendlinjer">
        <div className={`${CARD} grid gap-8 md:grid-cols-3`}>
          <div className="flex flex-col gap-2">
            <Heading level={4}>Räknas upp</Heading>
            <p className="text-4xl font-light">
              <CountUp value={1_234_567} unit="kr" />
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Heading level={4}>Trend med glapp</Heading>
            <Sparkline values={[...hoursTrend]} width={200} height={48} label="Timmar per månad" />
          </div>
          <div className="flex flex-col gap-2" data-static>
            <Heading level={4}>Statisk (data-static)</Heading>
            <p className="text-4xl font-light">
              <CountUp value={4711} unit="h" />
            </p>
            <Sparkline values={[3, 5, 4, 6, 8, 7, 9]} width={200} height={48} />
          </div>
        </div>
      </Section>

      <Section
        title="Diagram"
        description="Recharts med svensk formatering. Röd markerar aktuell månad."
      >
        <StatGrid columns={2}>
          <StatGridItem span={2} className={CARD}>
            <Heading level={3} className="mb-4">
              Timmar per månad
            </Heading>
            <MbLineChart data={lineChart} title="Timmar per månad, senaste 12 mån mot året innan" />
          </StatGridItem>
          <StatGridItem className={CARD}>
            <Heading level={3} className="mb-4">
              Fakturerat
            </Heading>
            <MbBarChart data={barChart} title="Fakturerat per månad" showValues />
          </StatGridItem>
          <StatGridItem className={CARD}>
            <Heading level={3} className="mb-4">
              Topp 5 kunder
            </Heading>
            <MbBarChart
              data={toplistChart}
              title="Timmar per kund"
              orientation="horizontal"
              showValues
            />
          </StatGridItem>
          <StatGridItem className={CARD}>
            <Heading level={3} className="mb-4">
              Deltagare per bolag
            </Heading>
            <MbStackedCompanyBar
              data={stackedChart}
              title="Deltagare per bolag och månad"
              showTotals
            />
          </StatGridItem>
          <StatGridItem className={CARD}>
            <Heading level={3} className="mb-4">
              Deltagare per verksamhet
            </Heading>
            <MbDonut data={donutChart} title="Deltagare per verksamhet" centerLabel="Totalt" />
          </StatGridItem>
        </StatGrid>
      </Section>

      <Section title="Tomt läge och formulär">
        <div className="grid gap-6 md:grid-cols-2">
          <EmptyState
            icon={<Inbox />}
            title="Ingen data ännu"
            description="Ladda upp månadens fil för att se nyckeltalen."
            action={<Button>Ladda upp</Button>}
          />
          <div className={`${CARD} flex flex-col gap-4`}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-input">Etikett</Label>
              <Input id="ds-input" placeholder="Skriv här" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button>Primär</Button>
              <Button variant="secondary">Sekundär</Button>
              <Button variant="outline">Kontur</Button>
              <Button variant="ghost">Spöke</Button>
              <Button variant="destructive">Ta bort</Button>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Presentationsläge"
        description="Klassen .theme-present: antracit duk, vit text."
      >
        <div className="theme-present flex flex-col gap-8 rounded-card p-6 md:p-10">
          <div className="flex items-center justify-between gap-6">
            <Heading level={1} accent="dot">
              Timmarna ökar
            </Heading>
            <Logo variant="white" size="sm" />
          </div>
          <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-3">
              <p className="text-6xl font-light">
                <CountUp value={5480} unit="h" static />
              </p>
              <Delta delta={up} size="lg" />
            </div>
            <MbLineChart
              data={lineChart}
              title="Timmar per månad (presentationsläge)"
              animate={false}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Logotyp"
        description="Originalfilen i public/brand/ om den finns, annars textversionen."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex items-center justify-center rounded-card bg-antracit p-10">
            <Logo variant="white" size="lg" />
          </div>
          <div className={`${CARD} flex items-center justify-center p-10 md:p-10`}>
            <Logo variant="dark" size="lg" />
          </div>
        </div>
      </Section>
    </div>
  );
}
