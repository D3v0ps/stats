"use client";

// Mapping a new (or changed) report type: one row per column of the file,
// tools that become steps, period/company (or case) settings, a live preview
// of the first 20 rows after the steps, undo/redo and "back to the original".
// Saving creates the template (or a new version) and the file is read with it.
import { Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ImportTemplate, SignatureDiff, Step } from "@/lib/contracts";
import type { StoredTemplate } from "@/lib/db/repo/templates";
import { fillNewColumns, migrateConfig } from "@/lib/import-ui/drift";
import type { InspectResponse, PreviewResponse } from "@/lib/import-ui/ingest-service";
import {
  datasetKind,
  fromTemplateConfig,
  hasBlockingProblems,
  initialMapping,
  isKept,
  mappingSteps,
  orderedOutput,
  setDataset,
  setHeaderRow,
  setTemplateName,
  toTemplateConfig,
  toolOutput,
  validateMapping,
  type MappingState,
} from "@/lib/import-ui/mapping";
import type { QueueItem } from "@/lib/import-ui/queue";
import { aliasTablesFromDictionary, type DictionaryEntry } from "@/lib/import-ui/review";
import { lookupDimensions } from "@/lib/import-ui/steps";
import {
  canRedo,
  canUndo,
  createHistory,
  historyShortcut,
  pushHistory,
  redo,
  resetHistory,
  undo,
  type History,
} from "@/lib/import-ui/undo";
import { saveTemplateAction } from "@/app/(app)/ladda-upp/actions";
import { CommitInput, Field, NativeSelect, Panel } from "../fields";
import type { IngestClient } from "../ingest-client";
import type { UploadCatalog } from "../types";
import { ViewHeader } from "../ViewHeader";
import { ColumnTable } from "./ColumnTable";
import { NewMetricDialog, type NewMetricRequest } from "./NewMetricDialog";
import { PreviewTable } from "./PreviewTable";
import { SourceSettings } from "./SourceSettings";
import { ToolPanel } from "./ToolPanel";

export type MappingBase =
  { kind: "new" } | { kind: "update"; template: StoredTemplate; diff: SignatureDiff | null };

interface Migration {
  removedSteps: Step[];
  missingColumns: string[];
  renames: { from: string; to: string }[];
}

export interface MappingViewProps {
  item: QueueItem;
  catalog: UploadCatalog;
  base: MappingBase;
  client: () => IngestClient;
  getDictionaries: (keys: readonly string[]) => Promise<Record<string, DictionaryEntry>>;
  onSaved: (template: StoredTemplate, headerRow?: number) => void;
  onCancel: () => void;
  onMetricCreated: (metric: UploadCatalog["metrics"][number]) => void;
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function MappingView(props: MappingViewProps) {
  const { item, catalog, base, client, getDictionaries, onSaved, onCancel, onMetricCreated } =
    props;
  const [sheet, setSheet] = useState<string | undefined>(item.sourceSheet);
  // A header row picked by hand: this upload's choice, else the one saved with the template.
  const [headerRow, setHeaderRowChoice] = useState<number | undefined>(
    item.headerRow ??
      (base.kind === "update" && base.template.config.kind !== "sie"
        ? base.template.config.headerRow
        : undefined),
  );
  const [inspect, setInspect] = useState<InspectResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<History<MappingState> | null>(null);
  const [original, setOriginal] = useState<MappingState | null>(null);
  const [migration, setMigration] = useState<Migration | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [triedSave, setTriedSave] = useState(false);
  const [metricRequest, setMetricRequest] = useState<NewMetricRequest | null>(null);
  const setup = useRef({ base, catalog });
  const previewSeq = useRef(0);

  // Read the file's columns and start the mapping (again when the sheet or header row changes).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { base: b, catalog: c } = setup.current;
      const datasetKey = b.kind === "update" ? b.template.datasetKey : null;
      const res = await client().call({
        op: "inspect",
        fileId: item.fileId,
        sheetHint: sheet,
        headerRow,
        datasetKey,
      });
      if (cancelled) return;
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      let state: MappingState;
      let m: Migration | null = null;
      if (b.kind === "update" && b.template.config.kind !== "sie") {
        let config = b.template.config;
        if (b.diff) {
          const migrated = migrateConfig(
            config,
            b.diff,
            res.columns.map((col) => col.name),
          );
          config = migrated.config;
          m = migrated;
        }
        state = fromTemplateConfig(config, res.columns, {
          datasetKey: b.template.datasetKey,
          templateName: b.template.name,
          catalog: c,
        });
        if (b.diff) state = fillNewColumns(state, res.suggestions, b.diff.added);
      } else {
        state = initialMapping(res.columns, res.suggestions, {
          datasetKey: null,
          templateName: "",
          catalog: c,
        });
      }
      // The template remembers the row, so next month's file is read from it too.
      state = setHeaderRow(state, headerRow);
      setLoadError(null);
      setInspect(res);
      setMigration(m);
      setHistory(createHistory(state));
      setOriginal(
        setHeaderRow(
          initialMapping(res.columns, res.suggestions, {
            datasetKey: state.datasetKey,
            templateName: state.templateName,
            catalog: c,
          }),
          headerRow,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [client, item.fileId, sheet, headerRow]);

  const state = history?.present ?? null;
  const edit = useCallback((fn: (s: MappingState) => MappingState) => {
    setHistory((h) => (h ? pushHistory(h, fn(h.present)) : h));
  }, []);

  // Live preview of the steps (debounced; stale answers are ignored).
  useEffect(() => {
    if (!state || !inspect) return;
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        setPreviewBusy(true);
        const steps = mappingSteps(state);
        const outputs = toolOutput(state).columns;
        const measures = outputs.flatMap((col) => {
          const f = state.fields[col];
          return f?.usage === "measure" ? [{ column: col, type: f.type }] : [];
        });
        const distinctFor = outputs.filter((col) => {
          const u = state.fields[col]?.usage;
          return u === "company" || u === "case_result";
        });
        let aliases = {};
        try {
          aliases = aliasTablesFromDictionary(await getDictionaries(lookupDimensions(steps)));
        } catch {
          // Without lookup tables the preview simply shows untranslated values.
        }
        const res = await client().call({
          op: "preview",
          fileId: item.fileId,
          sheetHint: sheet,
          headerRow,
          steps,
          aliases,
          datasetKey: state.datasetKey,
          measures,
          distinctFor,
        });
        if (seq !== previewSeq.current) return;
        setPreviewBusy(false);
        if (res.ok) setPreview(res);
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [state, inspect, client, getDictionaries, item.fileId, sheet, headerRow]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const action = historyShortcut(e);
      if (!action) return;
      e.preventDefault();
      setHistory((h) => (h ? (action === "undo" ? undo(h) : redo(h)) : h));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const problems = useMemo(() => (state ? validateMapping(state, catalog) : []), [state, catalog]);
  const kind = state ? datasetKind(catalog, state.datasetKey) : null;
  const visibleSheets = inspect?.sheets.filter((s) => !s.hidden) ?? [];

  const changeDataset = async (key: string) => {
    if (!state || !key) return;
    const res = await client().call({
      op: "inspect",
      fileId: item.fileId,
      sheetHint: sheet,
      headerRow,
      datasetKey: key,
    });
    const sheetName = visibleSheets.length > 1 ? inspect?.sheetName : undefined;
    edit((s) => setDataset(s, key, catalog, res.ok ? res.suggestions : undefined, sheetName));
  };

  const save = async () => {
    setTriedSave(true);
    if (!state || !inspect || hasBlockingProblems(problems)) return;
    setSaving(true);
    setSaveError(null);
    const template: ImportTemplate = {
      datasetKey: state.datasetKey!,
      name: state.templateName.trim(),
      headerSignature: inspect.signature,
      version: 1,
      config: toTemplateConfig(state, catalog),
      ...(visibleSheets.length > 1 ? { sheetHint: inspect.sheetName } : {}),
    };
    let res: Awaited<ReturnType<typeof saveTemplateAction>>;
    try {
      res = await saveTemplateAction({
        templateId: base.kind === "update" ? base.template.id : null,
        template,
      });
    } catch {
      res = { ok: false, error: "Mallen kunde inte sparas. Försök igen." };
    }
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      return;
    }
    onSaved(res.data, headerRow);
  };

  const title = base.kind === "update" ? "Uppdatera mallen" : "Mappa rapporten";
  const header = (
    <ViewHeader
      title={title}
      onBack={onCancel}
      description={
        <>
          <span className="font-medium text-foreground">{item.fileName}</span>
          {inspect ? ` · blad ${inspect.sheetName} · ${inspect.rowCount} rader` : ""}. Bestäm en
          gång vad kolumnerna betyder – nästa månad läses filen av sig själv.
        </>
      }
      actions={
        history ? (
          <>
            <Button
              variant="outline"
              onClick={() => setHistory((h) => (h ? undo(h) : h))}
              disabled={!canUndo(history)}
              aria-keyshortcuts="Control+Z"
              data-testid="undo-button"
            >
              <Undo2 aria-hidden="true" />
              Ångra
            </Button>
            <Button
              variant="outline"
              onClick={() => setHistory((h) => (h ? redo(h) : h))}
              disabled={!canRedo(history)}
              aria-keyshortcuts="Control+Shift+Z"
              data-testid="redo-button"
            >
              <Redo2 aria-hidden="true" />
              Gör om
            </Button>
            <Button
              variant="ghost"
              onClick={() => original && setHistory((h) => (h ? resetHistory(h, original) : h))}
              data-testid="reset-button"
            >
              <RotateCcw aria-hidden="true" />
              Återställ till originalfilen
            </Button>
          </>
        ) : null
      }
    />
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <Panel role="alert">{loadError}</Panel>
      </div>
    );
  }
  if (!state || !inspect) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <Panel aria-busy="true">Läser kolumnerna…</Panel>
      </div>
    );
  }

  const outputs = orderedOutput(state);
  const datasetOptions = catalog.datasets
    .filter((d) => d.kind !== "ledger")
    .map((d) => ({ value: d.key, label: d.name }));
  const blocking = problems.filter((p) => p.blocking);
  const advice = problems.filter((p) => !p.blocking);
  const keptCount = state.sources.filter(isKept).length;

  return (
    <div className="flex flex-col gap-8" data-testid="mapping-view">
      {header}

      {migration && (migration.removedSteps.length > 0 || migration.missingColumns.length > 0) ? (
        <Panel className="border-l-4 border-bla" role="status">
          <p className="text-sm">
            {migration.missingColumns.length > 0
              ? `Kolumner som saknas i den nya filen och har tagits bort ur mallen: ${migration.missingColumns.join(", ")}. `
              : ""}
            {migration.removedSteps.length > 0
              ? `${migration.removedSteps.length} steg behövde en kolumn som inte finns längre och har tagits bort.`
              : ""}
          </p>
        </Panel>
      ) : null}

      <Panel className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Vilken rapport är det här?" className="xl:col-span-2">
          {(id) => (
            <NativeSelect
              id={id}
              value={state.datasetKey ?? ""}
              placeholder="Välj rapport"
              options={datasetOptions}
              disabled={base.kind === "update"}
              onChange={(e) => void changeDataset(e.target.value)}
              data-testid="dataset-select"
            />
          )}
        </Field>
        <Field label="Mallens namn" hint="Visas när filen känns igen nästa gång.">
          {(id) => (
            <CommitInput
              id={id}
              value={state.templateName}
              onCommit={(value) => edit((s) => setTemplateName(s, value))}
              data-testid="template-name"
            />
          )}
        </Field>
        {visibleSheets.length > 1 ? (
          <Field label="Blad">
            {(id) => (
              <NativeSelect
                id={id}
                value={inspect.sheetName}
                options={visibleSheets.map((s) => ({ value: s.name, label: s.name }))}
                onChange={(e) => setSheet(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {inspect.confidence < 0.5 || headerRow !== undefined ? (
          <Field
            label="Rubrikraden står på rad"
            hint={
              inspect.confidence < 0.5 && headerRow === undefined
                ? "Rubrikerna var svåra att hitta. Kontrollera raden."
                : "Sparas i mallen och används för nästa månads fil."
            }
          >
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                className="num h-9 w-28 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                defaultValue={inspect.headerRow ?? 1}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n - 1 !== headerRow)
                    setHeaderRowChoice(n - 1);
                }}
                data-testid="header-row"
              />
            )}
          </Field>
        ) : null}
      </Panel>

      <ColumnTable
        state={state}
        catalog={catalog}
        kind={kind}
        inspect={inspect}
        preview={preview}
        outputs={outputs}
        edit={edit}
        onNewMetric={(column) => setMetricRequest({ column })}
      />
      <p className="-mt-5 text-xs text-muted-foreground">
        {keptCount} av {state.sources.length} kolumner tas med. Borttagna kolumner läses aldrig in
        och syns inte i förhandsgranskningen.
      </p>

      <ToolPanel
        state={state}
        catalog={catalog}
        columns={toolOutput(state).columns}
        headers={preview?.headers ?? {}}
        edit={edit}
        problems={problems}
        onNewMetric={() => setMetricRequest({ column: null })}
      />

      <SourceSettings
        state={state}
        catalog={catalog}
        kind={kind}
        preview={preview}
        outputs={outputs}
        edit={edit}
      />

      <PreviewTable
        preview={preview}
        busy={previewBusy}
        state={state}
        dimensionLabel={(k) => catalog.dimensions.find((d) => d.key === k)?.label ?? k}
      />

      <Panel className="flex flex-col gap-4">
        {(triedSave || blocking.length === 0) && problems.length > 0 ? (
          <ul
            className="flex flex-col gap-1.5 text-sm"
            data-testid="mapping-problems"
            aria-live="polite"
          >
            {blocking.map((p) => (
              <li key={p.message} className="flex gap-2">
                <span aria-hidden="true" className="text-rod">
                  ●
                </span>
                {p.message}
              </li>
            ))}
            {advice.map((p) => (
              <li key={p.message} className="flex gap-2 text-muted-foreground">
                <span aria-hidden="true">○</span>
                {p.message}
              </li>
            ))}
          </ul>
        ) : null}
        {saveError ? (
          <p role="alert" className="text-sm">
            {saveError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="px-5"
            onClick={() => void save()}
            disabled={saving}
            data-testid="save-template-button"
          >
            {saving ? "Sparar…" : "Spara mallen och fortsätt"}
          </Button>
          <Button size="lg" variant="outline" className="px-5" onClick={onCancel}>
            Avbryt
          </Button>
        </div>
      </Panel>

      {metricRequest && state.datasetKey ? (
        <NewMetricDialog
          request={metricRequest}
          datasetKey={state.datasetKey}
          suggestedType={
            metricRequest.column ? state.fields[metricRequest.column]?.type : undefined
          }
          onClose={() => setMetricRequest(null)}
          onCreated={(metric, column) => {
            onMetricCreated(metric);
            setMetricRequest(null);
            if (column)
              edit((s) => ({
                ...s,
                fields: {
                  ...s.fields,
                  [column]: {
                    ...(s.fields[column] ?? { type: "number", usage: "measure" }),
                    usage: "measure",
                    metricKey: metric.key,
                  },
                },
              }));
            else
              edit((s) => ({
                ...s,
                counters: [...s.counters, { metricKey: metric.key, kind: "count_rows" }],
              }));
          }}
        />
      ) : null}
    </div>
  );
}
