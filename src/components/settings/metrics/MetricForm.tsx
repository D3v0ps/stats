"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createFormulaMetricAction, updateMetricAction } from "@/app/(app)/installningar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Unit } from "@/lib/contracts/domain";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import {
  headlinePreview,
  initialMetricForm,
  metricFormIssues,
  toCreateInput,
  toUpdateInput,
  type MetricFormState,
} from "@/lib/settings-ui/metric-form";
import {
  DIRECTION_LABELS,
  KIND_EXPLANATIONS,
  KIND_LABELS,
  MAX_DECIMALS,
  MAX_WAGE_UPLIFT_PCT,
  UNITS,
  UNIT_LABELS,
  insertIntoFormula,
  parsePercentInput,
  percentInputText,
  suggestMetricKey,
  usesWageCost,
  wageUpliftPct,
  withWageUplift,
  type Direction,
} from "@/lib/settings-ui/metrics";
import { Field, NativeSelect, Notice, describedBy } from "../ui";
import { useSettingsAction } from "../use-settings-action";

export interface MetricFormProps {
  /** null = create a new formula metric. */
  metric: MetricDefinition | null;
  definitions: MetricDefinition[];
  dimensionLabels: Record<string, string>;
  onDone: () => void;
}

const DIRECTIONS: Direction[] = ["up", "down", "neutral"];

export function MetricForm({ metric, definitions, dimensionLabels, onDone }: MetricFormProps) {
  const id = useId();
  const mode = metric ? "edit" : "create";
  const isFormula = !metric || metric.kind === "formula";
  const [state, setState] = useState<MetricFormState>(() => initialMetricForm(metric));
  const [keyTouched, setKeyTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [wageText, setWageText] = useState(() => {
    const pct = wageUpliftPct(state.formula);
    return pct === null ? "" : percentInputText(pct);
  });
  const formulaRef = useRef<HTMLTextAreaElement>(null);
  const { pending, run } = useSettingsAction();

  const issues = useMemo(
    () => metricFormIssues(state, mode, definitions, isFormula),
    [state, mode, definitions, isFormula],
  );
  const insertable = useMemo(
    () =>
      definitions
        .filter((d) => d.key !== state.key)
        .sort((a, b) => a.name.localeCompare(b.name, "sv")),
    [definitions, state.key],
  );
  const showWage = isFormula && usesWageCost(state.formula);
  const wagePct = parsePercentInput(wageText);
  const wageError =
    showWage &&
    wageText.trim() !== "" &&
    (wagePct === null || wagePct < 0 || wagePct > MAX_WAGE_UPLIFT_PCT)
      ? `Skriv ett tal mellan 0 och ${MAX_WAGE_UPLIFT_PCT}.`
      : null;

  const set = <K extends keyof MetricFormState>(key: K, value: MetricFormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  function setName(name: string) {
    setState((s) => ({
      ...s,
      name,
      key:
        mode === "create" && !keyTouched
          ? suggestMetricKey(
              name,
              definitions.map((d) => d.key),
            )
          : s.key,
    }));
  }

  function setFormula(formula: string) {
    set("formula", formula);
    const pct = wageUpliftPct(formula);
    setWageText(pct === null ? "" : percentInputText(pct));
  }

  function setWage(text: string) {
    setWageText(text);
    const pct = parsePercentInput(text);
    if (pct !== null && pct >= 0 && pct <= MAX_WAGE_UPLIFT_PCT) {
      set("formula", withWageUplift(state.formula, pct));
    }
  }

  function insertMetric(key: string) {
    const el = formulaRef.current;
    const start = el?.selectionStart ?? state.formula.length;
    const end = el?.selectionEnd ?? state.formula.length;
    const next = insertIntoFormula(state.formula, start, end, key);
    setFormula(next.formula);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!issues.valid || wageError) return;
    if (mode === "edit") {
      run(updateMetricAction, toUpdateInput(state, isFormula), { onSuccess: onDone });
    } else {
      run(createFormulaMetricAction, toCreateInput(state), { onSuccess: onDone });
    }
  }

  const formulaErrors = issues.formula?.errors ?? [];
  const nameError = submitted ? issues.name : null;
  const keyError = mode === "create" && (submitted || keyTouched) ? issues.key : null;

  return (
    <form
      onSubmit={submit}
      className="flex min-h-full flex-col"
      data-testid="metric-form"
      noValidate
    >
      <SheetHeader className="gap-1 border-b px-5 py-5 md:px-6">
        <SheetTitle className="text-base font-medium tracking-[0.08em] uppercase">
          {mode === "edit" ? "Ändra mått" : "Nytt formelmått"}
        </SheetTitle>
        <SheetDescription>
          {mode === "edit"
            ? `${KIND_LABELS[metric!.kind]}: ${KIND_EXPLANATIONS[metric!.kind]}`
            : "Ett formelmått räknas fram ur andra mått, till exempel fakturerat per konsult."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-5 py-5 md:px-6">
        <Field id={`${id}-name`} label="Namn" error={nameError}>
          <Input
            id={`${id}-name`}
            value={state.name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy(`${id}-name`, { error: nameError })}
            data-testid="metric-name"
          />
        </Field>

        {mode === "create" ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id={`${id}-key`}
              label="Nyckel"
              hint="Används i formler. Kan inte ändras senare."
              error={keyError}
            >
              <Input
                id={`${id}-key`}
                value={state.key}
                onChange={(e) => {
                  setKeyTouched(true);
                  set("key", e.target.value.trim());
                }}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={keyError ? true : undefined}
                aria-describedby={describedBy(`${id}-key`, { hint: true, error: keyError })}
                data-testid="metric-key"
              />
            </Field>
            <Field id={`${id}-unit`} label="Enhet">
              <NativeSelect
                id={`${id}-unit`}
                value={state.unit}
                onChange={(e) => set("unit", e.target.value as Unit)}
                data-testid="metric-unit"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-ljusgra-100 px-4 py-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Nyckel</dt>
              <dd className="font-mono">{state.key}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Enhet</dt>
              <dd>{UNIT_LABELS[state.unit]}</dd>
            </div>
          </dl>
        )}

        <Field id={`${id}-description`} label="Beskrivning">
          <Textarea
            id={`${id}-description`}
            value={state.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={500}
            rows={2}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={`${id}-direction`}
            label="Riktning"
            hint="Avgör om en ökning visas som bra eller dålig."
          >
            <NativeSelect
              id={`${id}-direction`}
              value={state.direction}
              onChange={(e) => set("direction", e.target.value as Direction)}
              aria-describedby={`${id}-direction-hint`}
              data-testid="metric-direction"
            >
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABELS[d]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={`${id}-decimals`} label="Decimaler">
            <NativeSelect
              id={`${id}-decimals`}
              value={state.decimals}
              onChange={(e) => set("decimals", e.target.value)}
              data-testid="metric-decimals"
            >
              <option value="">Standard för enheten</option>
              {Array.from({ length: MAX_DECIMALS + 1 }, (_, n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <Field
          id={`${id}-subject`}
          label="Rubrikord"
          hint={
            <>
              Används i genererade rubriker, till exempel{" "}
              <span className="font-medium tracking-[0.08em] text-foreground">
                {headlinePreview(state)}
              </span>
            </>
          }
        >
          <Input
            id={`${id}-subject`}
            value={state.headlineSubject}
            onChange={(e) => set("headlineSubject", e.target.value)}
            maxLength={80}
            className="uppercase"
            aria-describedby={`${id}-subject-hint`}
            data-testid="metric-subject"
          />
        </Field>

        {isFormula ? (
          <div className="flex flex-col gap-3">
            <Field
              id={`${id}-formula`}
              label="Formel"
              hint="Måttens nycklar med + − * / och parenteser. Varje mått summeras för perioden först, sedan räknas formeln."
            >
              <Textarea
                ref={formulaRef}
                id={`${id}-formula`}
                value={state.formula}
                onChange={(e) => setFormula(e.target.value)}
                rows={3}
                maxLength={500}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                aria-invalid={formulaErrors.length > 0 ? true : undefined}
                aria-describedby={`${id}-formula-hint ${id}-formula-status`}
                data-testid="metric-formula"
              />
            </Field>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label htmlFor={`${id}-insert`} className="text-xs text-muted-foreground">
                Infoga mått
              </label>
              <NativeSelect
                id={`${id}-insert`}
                value=""
                onChange={(e) => e.target.value && insertMetric(e.target.value)}
                className="sm:max-w-xs"
              >
                <option value="">Välj ett mått…</option>
                {insertable.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name} ({d.key})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div
              id={`${id}-formula-status`}
              aria-live="polite"
              className="flex flex-col gap-2 text-sm"
            >
              {formulaErrors.length > 0 ? (
                <ul
                  className="flex flex-col gap-1 font-medium text-rod"
                  data-testid="formula-errors"
                >
                  {formulaErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : issues.formula && issues.formula.referenced.length > 0 ? (
                <>
                  <p>
                    <span className="text-muted-foreground">Använder: </span>
                    {issues.formula.referenced.map((r) => r.name).join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {issues.formula.dimensions.length > 0
                      ? `Kan delas upp på ${issues.formula.dimensions
                          .map((d) => (dimensionLabels[d] ?? d).toLocaleLowerCase("sv"))
                          .join(", ")}.`
                      : "Måtten har inga gemensamma dimensioner: formeln visas bara som total."}
                  </p>
                </>
              ) : null}
            </div>

            {showWage ? (
              <Notice className="flex flex-col gap-3">
                <Field
                  id={`${id}-wage`}
                  label="Lönepåslag %"
                  error={wageError}
                  hint={
                    <>
                      Lönekostnaden räknas upp med påslaget (sociala avgifter, pension). Med 31 %
                      blir formeln <code>fakturerat_ip / (lonekostnad * 1.31)</code>. 0 % betyder{" "}
                      <code>lonekostnad * 1.0</code>.
                    </>
                  }
                >
                  <Input
                    id={`${id}-wage`}
                    inputMode="decimal"
                    value={wageText}
                    onChange={(e) => setWage(e.target.value)}
                    className="max-w-32 bg-card"
                    aria-invalid={wageError ? true : undefined}
                    aria-describedby={describedBy(`${id}-wage`, { hint: true, error: wageError })}
                    data-testid="metric-wage-uplift"
                  />
                </Field>
              </Notice>
            ) : null}
          </div>
        ) : null}
      </div>

      <SheetFooter className="sticky bottom-0 flex-row justify-end gap-2 border-t bg-popover px-5 py-4 md:px-6">
        <SheetClose asChild>
          <Button type="button" variant="outline">
            Avbryt
          </Button>
        </SheetClose>
        <Button
          type="submit"
          disabled={pending || (isFormula && formulaErrors.length > 0) || Boolean(wageError)}
          data-testid="metric-save"
        >
          {pending ? "Sparar…" : mode === "edit" ? "Spara" : "Skapa mått"}
        </Button>
      </SheetFooter>
    </form>
  );
}
