"use client";

import { useId, useState } from "react";
import { setFiscalStartAction } from "@/app/(app)/installningar/actions";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";
import type { CompanyCode } from "@/lib/contracts/domain";
import { MONTH_OPTIONS, fiscalExplanation } from "@/lib/settings-ui/periods";
import { Field, NativeSelect, Notice, SettingsCard } from "./ui";
import { useSettingsAction } from "./use-settings-action";

export interface CompanyRow {
  code: CompanyCode;
  legalName: string;
  shortName: string;
  orgNr: string;
  fiscalStartMonth: number;
}

export function CompaniesEditor({ companies }: { companies: CompanyRow[] }) {
  const starts = new Set(companies.map((c) => c.fiscalStartMonth));
  const first = companies[0];
  return (
    <div className="flex flex-col gap-6">
      {starts.size > 1 && first ? (
        <Notice tone="warning">
          Bolagen har olika räkenskapsår. Översikten och rapporterna räknar ”Hittills i år” och
          kvartal efter räkenskapsåret för {first.shortName}, även för Summa bolag. Välj samma
          startmånad för båda om ni inte behöver olika.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {companies.map((c) => (
          <CompanyCard key={`${c.code}:${c.fiscalStartMonth}`} company={c} />
        ))}
      </div>
    </div>
  );
}

function CompanyCard({ company }: { company: CompanyRow }) {
  const id = useId();
  const [month, setMonth] = useState(company.fiscalStartMonth);
  const { pending, run } = useSettingsAction();
  const dirty = month !== company.fiscalStartMonth;

  return (
    <SettingsCard className="flex flex-col gap-5" data-testid={`company-${company.code}`}>
      <div className="flex flex-col gap-1">
        <Heading level={3}>{company.legalName}</Heading>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Kortnamn:</dt>
            <dd>{company.shortName}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Org.nr:</dt>
            <dd className="num">{company.orgNr}</dd>
          </div>
        </dl>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(setFiscalStartAction, { company: company.code, month });
        }}
      >
        <Field id={`${id}-start`} label="Räkenskapsåret börjar i" hint={fiscalExplanation(month)}>
          <NativeSelect
            id={`${id}-start`}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="max-w-xs"
            aria-describedby={`${id}-start-hint`}
            data-testid="company-fiscal-start"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={!dirty || pending} data-testid="company-save">
            {pending ? "Sparar…" : "Spara"}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMonth(company.fiscalStartMonth)}
            >
              Ångra
            </Button>
          ) : null}
        </div>
      </form>
    </SettingsCard>
  );
}
