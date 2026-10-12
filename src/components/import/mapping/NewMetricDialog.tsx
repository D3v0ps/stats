"use client";

import { useState } from "react";
import type { ColumnType } from "@/lib/contracts";
import {
  NEW_METRIC_KINDS,
  NEW_METRIC_UNITS,
  NewMetricSchema,
  unitForColumnType,
  type NewMetric,
} from "@/lib/import-ui/metric-key";
import { createMetricAction } from "@/app/(app)/ladda-upp/actions";
import { Field } from "../fields";
import { ImportDialog } from "../ImportDialog";
import type { UploadCatalog } from "../types";

export interface NewMetricRequest {
  /** Column the metric is for; null for "Räkna rader". */
  column: string | null;
}

const BETTER = [
  { value: "true", label: "Ja, högre är bättre" },
  { value: "false", label: "Nej, lägre är bättre" },
  { value: "null", label: "Varken eller" },
];

export function NewMetricDialog({
  request,
  datasetKey,
  suggestedType,
  onClose,
  onCreated,
}: {
  request: NewMetricRequest;
  datasetKey: string;
  suggestedType?: ColumnType;
  onClose: () => void;
  onCreated: (metric: UploadCatalog["metrics"][number], column: string | null) => void;
}) {
  const [name, setName] = useState(request.column ?? "");
  const [unit, setUnit] = useState<NewMetric["unit"]>(
    request.column ? unitForColumnType(suggestedType ?? "number") : "st",
  );
  const [kind, setKind] = useState<NewMetric["kind"]>("sum");
  const [better, setBetter] = useState("null");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const input = {
      datasetKey,
      name,
      unit,
      kind,
      higherIsBetter: better === "null" ? null : better === "true",
    };
    const parsed = NewMetricSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Kontrollera uppgifterna.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createMetricAction(parsed.data);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated({ ...res.data, datasetKey }, request.column);
  };

  return (
    <ImportDialog
      open
      onClose={onClose}
      title="Nytt mått"
      description="Ett mått är en siffra som visas i översikten och rapporterna, till exempel timmar eller antal pass."
      submitLabel="Skapa måttet"
      busy={busy}
      onSubmit={() => void submit()}
      testId="new-metric-dialog"
    >
      <Field label="Namn">
        {(id) => (
          <input
            id={id}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid="new-metric-name"
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium tracking-[0.06em] text-antracit-300 uppercase">
          Enhet
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {NEW_METRIC_UNITS.map((u) => (
            <label key={u.unit} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                className="accent-antracit"
                name="unit"
                value={u.unit}
                checked={unit === u.unit}
                onChange={() => setUnit(u.unit)}
              />
              {u.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium tracking-[0.06em] text-antracit-300 uppercase">
          Hur räknas flera månader?
        </legend>
        {NEW_METRIC_KINDS.map((k) => (
          <label
            key={k.kind}
            className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm has-checked:border-bla has-checked:bg-bla-100"
          >
            <input
              type="radio"
              name="kind"
              value={k.kind}
              checked={kind === k.kind}
              onChange={() => setKind(k.kind)}
              className="mt-1 accent-antracit"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{k.label}</span>
              <span className="text-muted-foreground">{k.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium tracking-[0.06em] text-antracit-300 uppercase">
          Är högre bättre?
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {BETTER.map((b) => (
            <label key={b.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                className="accent-antracit"
                name="better"
                value={b.value}
                checked={better === b.value}
                onChange={() => setBetter(b.value)}
              />
              {b.label}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </ImportDialog>
  );
}
