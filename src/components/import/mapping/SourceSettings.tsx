"use client";

// Period and company (tables), the case fields (participant and employment
// lists) and the budget sign question.
import type { ReactNode } from "react";
import { Heading } from "@/components/brand/Heading";
import {
  COMPANY_FILTER_LABELS,
  type CasesConfig,
  type ColumnUsage,
  type CompanyCode,
  type DatasetKind,
} from "@/lib/contracts";
import type { PreviewResponse } from "@/lib/import-ui/ingest-service";
import {
  companyChoice,
  setBudgetSign,
  setCases,
  setCompanyChoice,
  setCompanyMapping,
  setField,
  setPeriodColumn,
  type MappingState,
} from "@/lib/import-ui/mapping";
import { monthOptions } from "@/lib/import-ui/months";
import { normalizeValue } from "@/lib/core/normalize";
import { Field, NativeSelect, Panel } from "../fields";
import type { UploadCatalog } from "../types";

const COMPANIES: CompanyCode[] = ["MBAB", "MBR"];
const radio = "accent-antracit";

function Radio({
  name,
  checked,
  onChange,
  children,
  testId,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className={`${radio} mt-0.5`}
        data-testid={testId}
      />
      <span className="flex flex-col gap-1">{children}</span>
    </label>
  );
}

const CASE_FIELDS: { usage: ColumnUsage; label: string; hint?: string; required?: boolean }[] = [
  { usage: "case_start", label: "Startdatum", required: true },
  { usage: "case_end", label: "Slutdatum", hint: "Tomt slutdatum betyder pågående." },
  {
    usage: "case_interrupt",
    label: "Avbrott",
    hint: "Ifylld cell (till exempel ”Ja”) räknas som avbrott.",
  },
  { usage: "case_result", label: "Resultat" },
  { usage: "case_result_date", label: "Resultatdatum" },
  {
    usage: "case_key",
    label: "Id",
    hint: "Räknas men sparas inte. Används för att inte räkna samma person två gånger.",
  },
];

const CASE_METRIC_ROLES: { role: keyof CasesConfig["metrics"]; label: string }[] = [
  { role: "active", label: "Aktiva vid månadens slut" },
  { role: "started", label: "Startade under månaden" },
  { role: "ended", label: "Avslutade under månaden" },
  { role: "interrupted", label: "Avbrott under månaden" },
  { role: "results", label: "Till arbete eller studier" },
  { role: "tenureMonths", label: "Genomsnittlig tid (månader)" },
];

const RESULT_LABELS = ["Arbete", "Studier"];

export function SourceSettings({
  state,
  catalog,
  kind,
  preview,
  outputs,
  edit,
}: {
  state: MappingState;
  catalog: UploadCatalog;
  kind: DatasetKind | null;
  preview: PreviewResponse | null;
  outputs: string[];
  edit: (fn: (s: MappingState) => MappingState) => void;
}) {
  if (!kind) return null;
  const columnOptions = outputs.map((c) => ({ value: c, label: preview?.headers[c] ?? c }));
  const withUsage = (u: ColumnUsage) => outputs.find((c) => state.fields[c]?.usage === u);
  const company = companyChoice(state);
  const companyColumn = company.kind === "column" ? company.column : undefined;
  const companyValues = companyColumn ? (preview?.distinct[companyColumn] ?? []) : [];

  const companySection = (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium tracking-[0.06em] uppercase">Bolag</legend>
      <Radio
        name="company"
        checked={company.kind === "fixed" && company.company === "MBAB"}
        onChange={() => edit((s) => setCompanyChoice(s, { kind: "fixed", company: "MBAB" }))}
        testId="company-mbab"
      >
        Alltid MB AB
      </Radio>
      <Radio
        name="company"
        checked={company.kind === "fixed" && company.company === "MBR"}
        onChange={() => edit((s) => setCompanyChoice(s, { kind: "fixed", company: "MBR" }))}
        testId="company-mbr"
      >
        Alltid MB Restart
      </Radio>
      <Radio
        name="company"
        checked={company.kind === "per_upload"}
        onChange={() => edit((s) => setCompanyChoice(s, { kind: "per_upload" }))}
        testId="company-per-upload"
      >
        Väljs vid varje uppladdning
      </Radio>
      <Radio
        name="company"
        checked={company.kind === "column"}
        onChange={() =>
          outputs[0] && edit((s) => setCompanyChoice(s, { kind: "column", column: outputs[0]! }))
        }
        testId="company-column"
      >
        En kolumn i filen
        {company.kind === "column" ? (
          <span className="flex flex-col gap-3">
            <NativeSelect
              aria-label="Kolumnen med bolag"
              value={company.column}
              options={columnOptions}
              onChange={(e) =>
                edit((s) => setCompanyChoice(s, { kind: "column", column: e.target.value }))
              }
            />
            {companyValues.length > 0 ? (
              <span className="grid gap-2 sm:grid-cols-2">
                {companyValues.map((v) => (
                  <Field key={v} label={v}>
                    {(id) => (
                      <NativeSelect
                        id={id}
                        value={state.companyMapping[v] ?? ""}
                        placeholder="Känns igen av sig själv"
                        options={COMPANIES.map((c) => ({
                          value: c,
                          label: COMPANY_FILTER_LABELS[c],
                        }))}
                        onChange={(e) =>
                          edit((s) =>
                            setCompanyMapping(s, v, (e.target.value || null) as CompanyCode | null),
                          )
                        }
                      />
                    )}
                  </Field>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
      </Radio>
    </fieldset>
  );

  if (kind === "cases") {
    const metrics = catalog.metrics.filter(
      (m) => m.datasetKey === state.datasetKey && m.kind !== "distinct",
    );
    const resultColumn = withUsage("case_result");
    const resultValues = resultColumn ? (preview?.distinct[resultColumn] ?? []) : [];
    const groupBy = outputs.filter((c) => state.fields[c]?.usage === "dimension");
    return (
      <section aria-labelledby="cases-heading" className="flex flex-col gap-4">
        <Heading id="cases-heading" level={3}>
          Deltagare och anställningar
        </Heading>
        <Panel className="flex flex-col gap-8">
          <p className="text-sm text-muted-foreground">
            Varje rad är en person eller anställning. Bara antal räknas fram – inga namn eller id
            sparas.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CASE_FIELDS.map((f) => (
              <Field
                key={f.usage}
                label={`${f.label}${f.required ? "" : " (valfritt)"}`}
                hint={f.hint}
              >
                {(id) => (
                  <NativeSelect
                    id={id}
                    value={withUsage(f.usage) ?? ""}
                    placeholder={f.required ? "Välj kolumn" : "Ingen"}
                    options={columnOptions}
                    onChange={(e) => {
                      const col = e.target.value;
                      const current = withUsage(f.usage);
                      edit((s) => {
                        let next = current ? setField(s, current, { usage: "ignore" }) : s;
                        if (col) next = setField(next, col, { usage: f.usage });
                        return next;
                      });
                    }}
                    data-testid={`case-${f.usage}`}
                  />
                )}
              </Field>
            ))}
            <Field label="Avbrottsdatum (valfritt)">
              {(id) => (
                <NativeSelect
                  id={id}
                  value={state.cases.interruptDateColumn ?? ""}
                  placeholder="Ingen"
                  options={columnOptions}
                  onChange={(e) =>
                    edit((s) => setCases(s, { interruptDateColumn: e.target.value || undefined }))
                  }
                />
              )}
            </Field>
            <Field
              label="Räkna från månad (valfritt)"
              hint="Annars från den första startmånaden i filen."
            >
              {(id) => (
                <NativeSelect
                  id={id}
                  value={state.cases.fromMonth ?? ""}
                  placeholder="Första startmånaden"
                  options={monthOptions(
                    new Date(),
                    state.cases.fromMonth ? [state.cases.fromMonth] : [],
                    { back: 120, ahead: 0 },
                  )}
                  onChange={(e) =>
                    edit((s) => setCases(s, { fromMonth: e.target.value || undefined }))
                  }
                />
              )}
            </Field>
          </div>

          {resultColumn ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium tracking-[0.06em] uppercase">
                Vad betyder resultaten?
              </legend>
              {resultValues.length === 0 ? (
                <p className="text-sm text-muted-foreground">Inga resultat i filen ännu.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {resultValues.map((v) => {
                    const key = normalizeValue(v);
                    return (
                      <Field key={key} label={v}>
                        {(id) => (
                          <NativeSelect
                            id={id}
                            value={state.cases.resultMap[key] ?? ""}
                            placeholder="Räknas inte"
                            options={RESULT_LABELS.map((l) => ({ value: l, label: l }))}
                            onChange={(e) =>
                              edit((s) => {
                                const resultMap = { ...s.cases.resultMap };
                                if (e.target.value) resultMap[key] = e.target.value;
                                else delete resultMap[key];
                                return setCases(s, { resultMap });
                              })
                            }
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>
              )}
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium tracking-[0.06em] uppercase">
              Mått att räkna fram
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CASE_METRIC_ROLES.map((r) => (
                <Field key={r.role} label={r.label}>
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={state.cases.metrics[r.role] ?? ""}
                      placeholder="Räknas inte"
                      options={metrics.map((m) => ({ value: m.key, label: m.name }))}
                      onChange={(e) =>
                        edit((s) =>
                          setCases(s, {
                            metrics: { ...s.cases.metrics, [r.role]: e.target.value || undefined },
                          }),
                        )
                      }
                    />
                  )}
                </Field>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Grupperas på:{" "}
              {groupBy.length > 0
                ? groupBy.map((c) => preview?.headers[c] ?? c).join(", ")
                : "inget (välj ”Gruppera på” för en kolumn ovan)"}
              .
            </p>
          </fieldset>
          {companySection}
        </Panel>
      </section>
    );
  }

  const periodColumn = withUsage("period");
  return (
    <section aria-labelledby="period-heading" className="flex flex-col gap-4">
      <Heading id="period-heading" level={3}>
        Period och bolag
      </Heading>
      <Panel className="grid gap-8 lg:grid-cols-2">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium tracking-[0.06em] uppercase">
            Vilken månad gäller raderna?
          </legend>
          <Radio
            name="period"
            checked={periodColumn !== undefined}
            onChange={() => {
              const col = outputs.find((c) => state.fields[c]?.type === "date") ?? outputs[0];
              if (col) edit((s) => setPeriodColumn(s, col));
            }}
            testId="period-column"
          >
            En kolumn i filen
            {periodColumn ? (
              <NativeSelect
                aria-label="Kolumnen med datum eller månad"
                value={periodColumn}
                options={columnOptions}
                onChange={(e) => edit((s) => setPeriodColumn(s, e.target.value))}
              />
            ) : null}
          </Radio>
          <Radio
            name="period"
            checked={periodColumn === undefined}
            onChange={() => edit((s) => setPeriodColumn(s, null))}
            testId="period-per-upload"
          >
            Hela filen är en månad
            <span className="text-muted-foreground">Månaden väljs när filen laddas upp.</span>
          </Radio>
        </fieldset>
        {companySection}
        {state.datasetKey === "budget" ? (
          <fieldset className="flex flex-col gap-3 lg:col-span-2">
            <legend className="mb-1 text-sm font-medium tracking-[0.06em] uppercase">
              Hur skrivs beloppen?
            </legend>
            <Radio
              name="budget-sign"
              checked={state.budgetSign === "income_positive"}
              onChange={() => edit((s) => setBudgetSign(s, "income_positive"))}
              testId="budget-income-positive"
            >
              Intäkter med plus och kostnader med minus
              <span className="text-muted-foreground">Som de flesta budgetark skrivs.</span>
            </Radio>
            <Radio
              name="budget-sign"
              checked={state.budgetSign === "ledger"}
              onChange={() => edit((s) => setBudgetSign(s, "ledger"))}
              testId="budget-ledger"
            >
              Som i bokföringen: intäkter med minus och kostnader med plus
              <span className="text-muted-foreground">Som en export från Fortnox.</span>
            </Radio>
          </fieldset>
        ) : null}
      </Panel>
    </section>
  );
}
