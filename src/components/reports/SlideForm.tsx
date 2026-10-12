"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GRAIN_LABELS } from "@/lib/app/filters";
import {
  COMPANY_FILTER_LABELS,
  CompanyFilterSchema,
  PeriodGrainSchema,
} from "@/lib/contracts/domain";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { VIZ_LABELS, VizKindSchema, type SlideSpec } from "@/lib/contracts/slides";
import type { FilterValue } from "@/lib/db/repo/present-extra";
import type { ReportDimension } from "@/lib/present/context";
import {
  COMPARE_CHOICES,
  NO_GROUP,
  filterableDimensions,
  fromCompareChoice,
  groupByChoices,
  metricChoices,
  slideHints,
  toCompareChoice,
  usesGroupBy,
  usesTopN,
} from "@/lib/present/editor-options";
import { clearFilter, parseTopN, toggleFilterValue, withMetric } from "@/lib/present/spec-edit";
import { FilterPicker } from "./FilterPicker";

export type EditorMetric = Pick<MetricDefinition, "key" | "name" | "unit" | "dimensions">;

export interface SlideFormProps {
  slide: SlideSpec;
  metrics: EditorMetric[];
  dimensions: ReportDimension[];
  filterValues: Record<string, FilterValue[]>;
  /** Placeholder for the headline: the live suggestion from the preview. */
  suggestedHeadline: string | null;
  onChange: (slide: SlideSpec) => void;
}

const HEADLINE_MAX = 80;
const NOTES_MAX = 4000;

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onValueChange,
  disabled,
  hint,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
  testId: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="h-9 w-full"
          data-testid={testId}
          aria-describedby={hint ? `${id}-hint` : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function TopNField({
  id,
  slide,
  onChange,
}: {
  id: string;
  slide: SlideSpec;
  onChange: (topN: number | null) => void;
}) {
  const [text, setText] = useState(slide.topN === null ? "" : String(slide.topN));
  const parsed = parseTopN(text);
  const enabled = usesTopN(slide.viz);
  return (
    <Field
      id={id}
      label="Topp N"
      hint={
        parsed === undefined
          ? "Ange ett heltal från 1, eller lämna tomt."
          : enabled
            ? "Antal grupper som visas. Tomt = alla (topplistan visar 10)."
            : "Används bara när siffran bryts ned."
      }
    >
      <Input
        id={id}
        inputMode="numeric"
        value={text}
        disabled={!enabled}
        placeholder={slide.viz === "toplist" ? "10" : "Alla"}
        aria-invalid={parsed === undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setText(e.target.value);
          const next = parseTopN(e.target.value);
          if (next !== undefined) onChange(next);
        }}
        className="h-9"
        data-testid="field-topn"
      />
    </Field>
  );
}

/** Every setting of the selected slide. Personal dimensions are never offered. */
export function SlideForm({
  slide,
  metrics,
  dimensions,
  filterValues,
  suggestedHeadline,
  onChange,
}: SlideFormProps) {
  const ids = useId();
  const def = metrics.find((m) => m.key === slide.metricKey);
  const patch = (fields: Partial<SlideSpec>) => onChange({ ...slide, ...fields });
  const grouping = usesGroupBy(slide.viz);
  const filterDims = filterableDimensions(def, dimensions);
  const hints = slideHints(slide);

  return (
    <div className="grid gap-5" data-testid="slide-form">
      <SelectField
        id={`${ids}-metric`}
        label="Mått"
        value={slide.metricKey}
        options={
          def
            ? metricChoices(metrics)
            : [{ value: slide.metricKey, label: slide.metricKey }, ...metricChoices(metrics)]
        }
        onValueChange={(key) => {
          const next = metrics.find((m) => m.key === key);
          if (next) onChange(withMetric(slide, next, dimensions));
        }}
        testId="field-metric"
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          id={`${ids}-viz`}
          label="Visualisering"
          value={slide.viz}
          options={VizKindSchema.options.map((v) => ({ value: v, label: VIZ_LABELS[v] }))}
          onValueChange={(v) => {
            const viz = VizKindSchema.safeParse(v);
            if (viz.success) patch({ viz: viz.data });
          }}
          testId="field-viz"
        />
        <SelectField
          id={`${ids}-grain`}
          label="Period"
          value={slide.grain}
          options={PeriodGrainSchema.options.map((g) => ({ value: g, label: GRAIN_LABELS[g] }))}
          onValueChange={(g) => {
            const grain = PeriodGrainSchema.safeParse(g);
            if (grain.success) patch({ grain: grain.data });
          }}
          testId="field-grain"
        />
        <SelectField
          id={`${ids}-company`}
          label="Bolag"
          value={slide.company}
          options={CompanyFilterSchema.options.map((c) => ({
            value: c,
            label: COMPANY_FILTER_LABELS[c],
          }))}
          onValueChange={(c) => {
            const company = CompanyFilterSchema.safeParse(c);
            if (company.success) patch({ company: company.data });
          }}
          testId="field-company"
        />
        <SelectField
          id={`${ids}-compare`}
          label="Jämförelse"
          value={toCompareChoice(slide.compare)}
          options={COMPARE_CHOICES}
          onValueChange={(c) => patch({ compare: fromCompareChoice(c) })}
          testId="field-compare"
        />
        <SelectField
          id={`${ids}-group`}
          label="Uppdelning"
          value={slide.groupBy ?? NO_GROUP}
          options={groupByChoices(def, dimensions)}
          onValueChange={(g) => patch({ groupBy: g === NO_GROUP ? null : g })}
          disabled={!grouping}
          hint={
            grouping
              ? undefined
              : `Används inte för ${VIZ_LABELS[slide.viz].toLocaleLowerCase("sv-SE")}.`
          }
          testId="field-group"
        />
        <TopNField
          key={slide.id}
          id={`${ids}-topn`}
          slide={slide}
          onChange={(topN) => patch({ topN })}
        />
      </div>

      {filterDims.length > 0 ? (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Filter</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {filterDims.map((d) => (
              <FilterPicker
                key={d.key}
                id={`${ids}-filter-${d.key}`}
                dimension={d}
                values={filterValues[d.key] ?? []}
                selected={slide.filters.find((f) => f.dimension === d.key)?.valueIds ?? []}
                onToggle={(valueId) => onChange(toggleFilterValue(slide, d.key, valueId))}
                onClear={() => onChange(clearFilter(slide, d.key))}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      {hints.length > 0 ? (
        <ul className="grid gap-1 rounded-lg bg-bla-100 px-4 py-3 text-sm text-antracit">
          {hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}

      <Field
        id={`${ids}-headline`}
        label="Rubrik"
        hint="Lämna tomt för den föreslagna rubriken. Visas med versaler."
      >
        <Input
          id={`${ids}-headline`}
          value={slide.headline ?? ""}
          maxLength={HEADLINE_MAX}
          placeholder={suggestedHeadline ? `Förslag: ${suggestedHeadline}` : "Föreslås automatiskt"}
          aria-describedby={`${ids}-headline-hint`}
          onChange={(e) => patch({ headline: e.target.value === "" ? null : e.target.value })}
          className="h-9"
          data-testid="field-headline"
        />
      </Field>
      <Field
        id={`${ids}-notes`}
        label="Talarmanus"
        hint="Syns bara i talarmanusfönstret, aldrig på bilden."
      >
        <Textarea
          id={`${ids}-notes`}
          value={slide.notes}
          maxLength={NOTES_MAX}
          rows={6}
          aria-describedby={`${ids}-notes-hint`}
          onChange={(e) => patch({ notes: e.target.value })}
          data-testid="field-notes"
        />
      </Field>
    </div>
  );
}
