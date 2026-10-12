"use client";

// The tools (each becomes a step) and the list of steps added so far.
import {
  ArrowDownToLine,
  Columns2,
  Combine,
  Eraser,
  Filter,
  Hash,
  Languages,
  PlusSquare,
  Replace,
  Rows3,
  SquareMinus,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";
import {
  addCounter,
  addStep,
  measureMetrics,
  removeCounter,
  removeStep,
  type MappingProblem,
  type MappingState,
} from "@/lib/import-ui/mapping";
import { describeStep } from "@/lib/import-ui/steps";
import {
  TOOLS,
  buildTool,
  defaultSplitNames,
  guessMonthColumns,
  type ToolForm,
  type ToolKind,
} from "@/lib/import-ui/tools";
import { Field, NativeSelect, Panel } from "../fields";
import { ImportDialog } from "../ImportDialog";
import type { UploadCatalog } from "../types";

const ICONS: Record<ToolKind, LucideIcon> = {
  merge: Combine,
  split: Columns2,
  lookup: Languages,
  replace: Replace,
  clean: Eraser,
  filter: Filter,
  fill_down: ArrowDownToLine,
  negate: SquareMinus,
  constant: PlusSquare,
  unpivot: Rows3,
  counter: Hash,
};

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ToolPanel({
  state,
  catalog,
  columns,
  headers,
  edit,
  problems,
  onNewMetric,
}: {
  state: MappingState;
  catalog: UploadCatalog;
  columns: string[];
  headers: Record<string, string>;
  edit: (fn: (s: MappingState) => MappingState) => void;
  problems: MappingProblem[];
  onNewMetric: () => void;
}) {
  const [open, setOpen] = useState<ToolKind | null>(null);
  const counterMetric = (key: string) => catalog.metrics.find((m) => m.key === key)?.name ?? key;
  const dimensionLabel = (key: string) =>
    catalog.dimensions.find((d) => d.key === key)?.label ?? key;
  const stepProblems = problems.filter((p) => p.message.startsWith("Steg "));

  return (
    <section aria-labelledby="tools-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading id="tools-heading" level={3}>
          Verktyg
        </Heading>
        <p className="text-sm text-muted-foreground">
          Städa filen innan siffrorna räknas. Varje verktyg blir ett steg som görs om automatiskt
          nästa månad.
        </p>
      </div>
      <Panel className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {TOOLS.map((t) => {
            const Icon = ICONS[t.kind];
            const disabled =
              t.kind === "counter" &&
              (!state.datasetKey || measureMetrics(catalog, state.datasetKey).length === 0);
            return (
              <button
                key={t.kind}
                type="button"
                disabled={disabled}
                onClick={() => setOpen(t.kind)}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-bla hover:bg-bla-100 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                data-testid={`tool-${t.kind}`}
              >
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-antracit-300" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        {state.tools.length > 0 || state.counters.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium tracking-[0.06em] text-antracit-300 uppercase">
              Steg
            </h4>
            <ol className="flex flex-col gap-2" data-testid="step-list">
              {state.tools.map((step, i) => (
                <li
                  key={`${i}-${step.op}`}
                  className="flex items-center gap-3 rounded-lg bg-ljusgra-100 px-3 py-2 text-sm"
                >
                  <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-card text-xs">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    {describeStep(step, { columnLabel: (c) => headers[c] ?? c, dimensionLabel })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Ta bort steg ${i + 1}`}
                    onClick={() => edit((s) => removeStep(s, i))}
                    data-testid="remove-step"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
              {state.counters.map((c) => (
                <li
                  key={c.metricKey}
                  className="flex items-center gap-3 rounded-lg bg-ljusgra-100 px-3 py-2 text-sm"
                >
                  <Hash aria-hidden="true" className="size-4 text-antracit-300" />
                  <span className="min-w-0 flex-1">
                    Räkna rader som ”{counterMetric(c.metricKey)}”
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Sluta räkna rader som ${counterMetric(c.metricKey)}`}
                    onClick={() => edit((s) => removeCounter(s, c.metricKey))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
            {stepProblems.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
                {stepProblems.map((p) => (
                  <li key={p.message}>
                    <span aria-hidden="true" className="mr-2 text-rod">
                      ●
                    </span>
                    {p.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Panel>
      {open ? (
        <ToolDialog
          kind={open}
          state={state}
          catalog={catalog}
          columns={columns}
          headers={headers}
          onClose={() => setOpen(null)}
          onNewMetric={() => {
            setOpen(null);
            onNewMetric();
          }}
          onAdd={(result) => {
            if ("step" in result) edit((s) => addStep(s, result.step));
            else edit((s) => addCounter(s, result.counter));
            setOpen(null);
          }}
        />
      ) : null}
    </section>
  );
}

function ColumnChecklist({
  columns,
  headers,
  selected,
  onChange,
  legend,
}: {
  columns: string[];
  headers: Record<string, string>;
  selected: string[];
  onChange: (next: string[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium tracking-[0.06em] text-antracit-300 uppercase">
        {legend}
      </legend>
      <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
        {columns.map((c) => (
          <label
            key={c}
            className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-ljusgra-100"
          >
            <input
              type="checkbox"
              className="accent-antracit"
              checked={selected.includes(c)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, c] : selected.filter((x) => x !== c))
              }
            />
            <span className="truncate">{headers[c] ?? c}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ToolDialog({
  kind,
  state,
  catalog,
  columns,
  headers,
  onClose,
  onAdd,
  onNewMetric,
}: {
  kind: ToolKind;
  state: MappingState;
  catalog: UploadCatalog;
  columns: string[];
  headers: Record<string, string>;
  onClose: () => void;
  onAdd: (r: Exclude<ReturnType<typeof buildTool>, { ok: false }>) => void;
  onNewMetric: () => void;
}) {
  const tool = TOOLS.find((t) => t.kind === kind)!;
  const [form, setForm] = useState<ToolForm>(() => {
    switch (kind) {
      case "merge":
        return { columns: [], separator: " ", into: "" };
      case "split":
        return { mode: "delimiter", delimiter: "", intoList: ["", ""] };
      case "replace":
        return { match: "contains", caseSensitive: false, find: "", replace: "" };
      case "clean":
        return { as: "number" };
      case "filter":
        return { operator: "equals", value: "" };
      case "unpivot":
        return {
          columns: guessMonthColumns(columns, headers),
          nameColumn: "månad",
          valueColumn: "värde",
        };
      default:
        return {};
    }
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<ToolForm>) => setForm((f) => ({ ...f, ...patch }));
  const columnOptions = columns.map((c) => ({ value: c, label: headers[c] ?? c }));

  const columnSelect = (label = "Kolumn") => (
    <Field label={label}>
      {(id) => (
        <NativeSelect
          id={id}
          value={form.column ?? ""}
          placeholder="Välj kolumn"
          options={columnOptions}
          onChange={(e) => {
            const column = e.target.value || undefined;
            set(
              kind === "split" && column
                ? { column, intoList: defaultSplitNames(column, form.mode) }
                : { column },
            );
          }}
          data-testid="tool-column"
        />
      )}
    </Field>
  );
  const text = (label: string, key: keyof ToolForm, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          className={inputClass}
          value={(form[key] as string | undefined) ?? ""}
          onChange={(e) => set({ [key]: e.target.value } as Partial<ToolForm>)}
          data-testid={`tool-${String(key)}`}
        />
      )}
    </Field>
  );

  let body: ReactNode = null;
  switch (kind) {
    case "merge":
      body = (
        <>
          <ColumnChecklist
            legend="Kolumner att slå ihop"
            columns={columns}
            headers={headers}
            selected={form.columns ?? []}
            onChange={(v) => set({ columns: v })}
          />
          {text("Mellan värdena", "separator", "Till exempel ett mellanslag eller ” – ”.")}
          {text("Den nya kolumnens namn", "into")}
        </>
      );
      break;
    case "split":
      body = (
        <>
          {columnSelect()}
          <Field label="Hur delas texten?">
            {(id) => (
              <NativeSelect
                id={id}
                value={form.mode ?? "delimiter"}
                options={[
                  { value: "delimiter", label: "Vid ett tecken (till exempel / eller -)" },
                  { value: "year_month", label: "År och månad (2026-09)" },
                  { value: "last_first", label: "Efternamn, Förnamn" },
                ]}
                onChange={(e) => {
                  const mode = e.target.value as ToolForm["mode"];
                  set({ mode, intoList: defaultSplitNames(form.column ?? "kolumn", mode) });
                }}
              />
            )}
          </Field>
          {form.mode === "delimiter" ? text("Tecken", "delimiter") : null}
          {(form.intoList ?? []).map((name, i) => (
            <Field key={i} label={`Ny kolumn ${i + 1}`}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={name}
                  onChange={(e) => {
                    const next = [...(form.intoList ?? [])];
                    next[i] = e.target.value;
                    set({ intoList: next });
                  }}
                />
              )}
            </Field>
          ))}
          {form.mode === "delimiter" ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => set({ intoList: [...(form.intoList ?? []), ""] })}
            >
              Lägg till en kolumn
            </Button>
          ) : null}
        </>
      );
      break;
    case "lookup":
      body = (
        <>
          {columnSelect()}
          <Field
            label="Uppslagstabell"
            hint="Stavningar och koder som redan är kopplade till ett namn byts mot namnet."
          >
            {(id) => (
              <NativeSelect
                id={id}
                value={form.dimension ?? ""}
                placeholder="Välj tabell"
                options={catalog.dimensions.map((d) => ({ value: d.key, label: d.label }))}
                onChange={(e) => set({ dimension: e.target.value || undefined })}
              />
            )}
          </Field>
        </>
      );
      break;
    case "replace":
      body = (
        <>
          {columnSelect()}
          {text("Sök efter", "find")}
          {text("Ersätt med", "replace", "Lämna tomt för att ta bort texten.")}
          <Field label="Var?">
            {(id) => (
              <NativeSelect
                id={id}
                value={form.match ?? "contains"}
                options={[
                  { value: "contains", label: "Överallt där texten finns" },
                  { value: "whole_cell", label: "Bara när hela cellen är just den texten" },
                ]}
                onChange={(e) => set({ match: e.target.value as ToolForm["match"] })}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-antracit"
              checked={form.caseSensitive ?? false}
              onChange={(e) => set({ caseSensitive: e.target.checked })}
            />
            Skilj på stora och små bokstäver
          </label>
        </>
      );
      break;
    case "clean":
      body = (
        <>
          {columnSelect()}
          <Field label="Vad står i kolumnen?">
            {(id) => (
              <NativeSelect
                id={id}
                value={form.as ?? "number"}
                options={[
                  { value: "number", label: "Tal" },
                  { value: "amount", label: "Belopp (kr)" },
                  { value: "hours", label: "Timmar" },
                  { value: "percent", label: "Procent" },
                  { value: "trim", label: "Text – ta bort extra mellanslag" },
                ]}
                onChange={(e) => set({ as: e.target.value as ToolForm["as"] })}
              />
            )}
          </Field>
        </>
      );
      break;
    case "filter": {
      const needsValue =
        form.operator === "equals" ||
        form.operator === "not_equals" ||
        form.operator === "contains";
      body = (
        <>
          {columnSelect("Ta bort rader där kolumnen")}
          <Field label="Villkor">
            {(id) => (
              <NativeSelect
                id={id}
                value={form.operator ?? "equals"}
                options={[
                  { value: "equals", label: "är" },
                  { value: "not_equals", label: "inte är" },
                  { value: "contains", label: "innehåller" },
                  { value: "empty", label: "är tom" },
                  { value: "not_empty", label: "inte är tom" },
                ]}
                onChange={(e) => set({ operator: e.target.value as ToolForm["operator"] })}
              />
            )}
          </Field>
          {needsValue ? text("Värde", "value") : null}
        </>
      );
      break;
    }
    case "fill_down":
    case "negate":
      body = columnSelect();
      break;
    case "constant":
      body = (
        <>
          {text("Den nya kolumnens namn", "column", "Till exempel ”verksamhet”.")}
          {text("Värde på alla rader", "value", "Till exempel ”Bemanning”.")}
        </>
      );
      break;
    case "unpivot":
      body = (
        <>
          <ColumnChecklist
            legend="Kolumner som ska bli rader"
            columns={columns}
            headers={headers}
            selected={form.columns ?? []}
            onChange={(v) => set({ columns: v })}
          />
          {text("Kolumn för rubriken (månaden)", "nameColumn")}
          {text("Kolumn för värdet", "valueColumn")}
        </>
      );
      break;
    case "counter": {
      const options = measureMetrics(catalog, state.datasetKey).map((m) => ({
        value: m.key,
        label: m.name,
      }));
      body = (
        <>
          <Field label="Räkna raderna som">
            {(id) => (
              <NativeSelect
                id={id}
                value={form.metricKey ?? ""}
                placeholder="Välj mått"
                options={options}
                onChange={(e) => set({ metricKey: e.target.value || undefined })}
                data-testid="tool-metric"
              />
            )}
          </Field>
          <Button type="button" variant="ghost" onClick={onNewMetric}>
            Nytt mått…
          </Button>
        </>
      );
      break;
    }
  }

  return (
    <ImportDialog
      open
      onClose={onClose}
      title={tool.label}
      description={tool.description}
      submitLabel="Lägg till steget"
      testId="tool-dialog"
      onSubmit={() => {
        const r = buildTool(kind, form, columns);
        if (r.ok) onAdd(r);
        else setProblem(r.problem);
      }}
    >
      <div className="flex flex-col gap-4">{body}</div>
      {problem ? (
        <p role="alert" className="text-sm">
          {problem}
        </p>
      ) : null}
    </ImportDialog>
  );
}
