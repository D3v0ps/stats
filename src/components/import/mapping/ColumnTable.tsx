"use client";

// One row per column: keep/remove, the header and example values, new name,
// type, usage and metric or dimension. Kept columns can be reordered by drag
// (or with the keyboard: Space, arrow keys, Space).
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Heading } from "@/components/brand/Heading";
import { Checkbox } from "@/components/ui/checkbox";
import {
  COLUMN_TYPE_LABELS,
  COLUMN_USAGE_LABELS,
  type ColumnType,
  type DatasetKind,
} from "@/lib/contracts";
import type { InspectResponse, PreviewResponse } from "@/lib/import-ui/ingest-service";
import {
  datasetOf,
  headSteps,
  isKept,
  measureMetrics,
  moveColumn,
  renameSource,
  setField,
  setKeep,
  toolOutput,
  usagesFor,
  type FieldMapping,
  type MappingState,
  type SourceSetting,
} from "@/lib/import-ui/mapping";
import { cn } from "@/lib/utils";
import { CommitInput, NativeSelect } from "../fields";
import type { UploadCatalog } from "../types";

const NEW_METRIC = "__new__";
const TYPE_OPTIONS = (Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => ({
  value: t,
  label: COLUMN_TYPE_LABELS[t],
}));

const GRID =
  "xl:grid xl:grid-cols-[4.5rem_minmax(11rem,1.3fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_minmax(9rem,1fr)_minmax(10rem,1.1fr)] xl:items-center xl:gap-3";

interface ColumnTableProps {
  state: MappingState;
  catalog: UploadCatalog;
  kind: DatasetKind | null;
  inspect: InspectResponse;
  preview: PreviewResponse | null;
  outputs: string[];
  edit: (fn: (s: MappingState) => MappingState) => void;
  onNewMetric: (column: string) => void;
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "personal";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "personal" ? "bg-rod-100 text-antracit" : "bg-ljusgra-200 text-antracit-300",
      )}
    >
      {children}
    </span>
  );
}

function Samples({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="text-xs text-muted-foreground">Tom kolumn</span>;
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {values.slice(0, 4).map((v) => (
        <span
          key={v}
          className="max-w-[10rem] truncate rounded bg-ljusgra-100 px-1.5 py-0.5 text-xs text-antracit-300"
          title={v}
        >
          {v}
        </span>
      ))}
    </span>
  );
}

function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] tracking-[0.06em] text-antracit-300 uppercase xl:hidden">
      {children}
    </span>
  );
}

export function ColumnTable({
  state,
  catalog,
  kind,
  inspect,
  preview,
  outputs,
  edit,
  onNewMetric,
}: ColumnTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const flow = toolOutput(state);
  const sourceSamples = new Map(inspect.columns.map((c) => [c.name, c.samples]));
  const samplesOf = (column: string, source?: SourceSetting) =>
    preview?.samples[column] ?? (source ? (sourceSamples.get(source.name) ?? []) : []);

  const consumed = state.sources.filter(
    (s) => isKept(s) && flow.consumedBy[s.rename] !== undefined,
  );
  const removed = state.sources.filter((s) => !isKept(s));
  const dataset = datasetOf(catalog, state.datasetKey);
  const usageOptions = usagesFor(kind).map((u) => ({ value: u, label: COLUMN_USAGE_LABELS[u] }));
  const metricOptions = [
    ...measureMetrics(catalog, state.datasetKey).map((m) => ({ value: m.key, label: m.name })),
    ...(state.datasetKey && kind === "table" ? [{ value: NEW_METRIC, label: "Nytt mått…" }] : []),
  ];
  const dimensionOptions = (dataset?.dimensions ?? []).map((key) => {
    const d = catalog.dimensions.find((x) => x.key === key);
    return { value: key, label: `${d?.label ?? key}${d?.personal ? " (personuppgift)" : ""}` };
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) {
      const from = String(e.active.id);
      const to = String(e.over.id);
      edit((s) => moveColumn(s, from, to));
    }
  };

  const detail = (column: string, f: FieldMapping) => {
    const label = `för kolumnen ${column}`;
    if (f.usage === "measure") {
      return (
        <NativeSelect
          aria-label={`Mått ${label}`}
          value={f.metricKey ?? ""}
          placeholder={state.datasetKey ? "Välj mått" : "Välj rapport först"}
          options={metricOptions}
          disabled={!state.datasetKey}
          onChange={(e) => {
            if (e.target.value === NEW_METRIC) onNewMetric(column);
            else edit((s) => setField(s, column, { metricKey: e.target.value || undefined }));
          }}
          data-testid="metric-select"
        />
      );
    }
    if (f.usage === "dimension") {
      return (
        <NativeSelect
          aria-label={`Gruppera på ${label}`}
          value={f.dimensionKey ?? ""}
          placeholder={state.datasetKey ? "Välj gruppering" : "Välj rapport först"}
          options={dimensionOptions}
          disabled={!state.datasetKey}
          onChange={(e) =>
            edit((s) => setField(s, column, { dimensionKey: e.target.value || undefined }))
          }
          data-testid="dimension-select"
        />
      );
    }
    const notes: Partial<Record<FieldMapping["usage"], string>> = {
      period: "Varje rad hamnar i sin månad",
      company: "Värdena kopplas till bolag nedan",
      case_key: "Räknas men sparas inte",
      ignore: "Läses men används inte",
    };
    return <span className="text-xs text-muted-foreground">{notes[f.usage] ?? ""}</span>;
  };

  const controls = (column: string, f: FieldMapping) => (
    <>
      <div className="flex flex-col gap-1">
        <MobileLabel>Typ</MobileLabel>
        <NativeSelect
          aria-label={`Typ för kolumnen ${column}`}
          value={f.type}
          options={TYPE_OPTIONS}
          onChange={(e) => edit((s) => setField(s, column, { type: e.target.value as ColumnType }))}
          data-testid="type-select"
        />
      </div>
      <div className="flex flex-col gap-1">
        <MobileLabel>Används som</MobileLabel>
        <NativeSelect
          aria-label={`Användning för kolumnen ${column}`}
          value={usageOptions.some((o) => o.value === f.usage) ? f.usage : "ignore"}
          options={usageOptions}
          onChange={(e) =>
            edit((s) => setField(s, column, { usage: e.target.value as FieldMapping["usage"] }))
          }
          data-testid="usage-select"
        />
      </div>
      <div className="flex flex-col gap-1">
        <MobileLabel>Mått eller gruppering</MobileLabel>
        {detail(column, f)}
      </div>
    </>
  );

  return (
    <section aria-labelledby="columns-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading id="columns-heading" level={3}>
          Kolumner
        </Heading>
        <p className="text-sm text-muted-foreground">
          Bocka ur det som inte ska sparas. Personuppgifter är urbockade från början.
        </p>
      </div>
      <div className="rounded-card bg-card shadow-soft">
        <div
          className={cn(
            "hidden border-b border-border px-5 py-3 text-[11px] tracking-[0.06em] text-antracit-300 uppercase",
            GRID,
          )}
        >
          <span>Behåll</span>
          <span>Kolumn i filen</span>
          <span>Nytt namn</span>
          <span>Typ</span>
          <span>Används som</span>
          <span>Mått eller gruppering</span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Tryck mellanslag för att lyfta kolumnen, flytta med piltangenterna och släpp med mellanslag.",
            },
            announcements: {
              onDragStart: ({ active }) => `Kolumnen ${active.id} är lyft.`,
              onDragOver: ({ active, over }) =>
                over ? `Kolumnen ${active.id} är över ${over.id}.` : `Kolumnen ${active.id}.`,
              onDragEnd: ({ active, over }) =>
                over
                  ? `Kolumnen ${active.id} flyttades till ${over.id}.`
                  : `Kolumnen ${active.id} släpptes.`,
              onDragCancel: ({ active }) => `Flytten av ${active.id} avbröts.`,
            },
          }}
        >
          <SortableContext items={outputs} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-border" data-testid="column-rows">
              {outputs.map((column) => {
                const source = state.sources.find((s) => isKept(s) && s.rename === column);
                const createdBy = flow.createdBy[column];
                const f = state.fields[column] ?? {
                  type: preview?.inferred[column] ?? "text",
                  usage: "ignore",
                };
                return (
                  <SortableRow key={column} id={column}>
                    {(handle) => (
                      <>
                        <div className="flex items-center gap-2">
                          {handle}
                          {source ? (
                            <Checkbox
                              checked
                              aria-label={`Behåll kolumnen ${source.header}`}
                              onCheckedChange={() => edit((s) => setKeep(s, source.name, false))}
                              data-testid="keep-checkbox"
                            />
                          ) : (
                            <span className="w-4" aria-hidden="true" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium" title={source?.header ?? column}>
                              {source?.header ?? column}
                            </span>
                            {source?.personal ? <Badge tone="personal">Personuppgift</Badge> : null}
                            {createdBy !== undefined ? (
                              <Badge>
                                Ny kolumn, steg {createdBy - headSteps(state).length + 1}
                              </Badge>
                            ) : null}
                          </span>
                          <Samples values={samplesOf(column, source)} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <MobileLabel>Nytt namn</MobileLabel>
                          {source ? (
                            <CommitInput
                              aria-label={`Nytt namn för kolumnen ${source.header}`}
                              value={source.rename}
                              onCommit={(v) => edit((s) => renameSource(s, source.name, v.trim()))}
                              data-testid="rename-input"
                            />
                          ) : (
                            <span className="text-sm">{column}</span>
                          )}
                        </div>
                        {controls(column, f)}
                      </>
                    )}
                  </SortableRow>
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
        {consumed.length > 0 || removed.length > 0 ? (
          <ul
            className="divide-y divide-border border-t border-border"
            aria-label="Kolumner som inte blir egna kolumner"
          >
            {consumed.map((s) => (
              <li
                key={s.name}
                className={cn("flex flex-col gap-2 px-5 py-3 text-sm text-muted-foreground", GRID)}
              >
                <Checkbox
                  checked
                  disabled
                  aria-label={`Kolumnen ${s.header} används i ett steg`}
                  className="ml-6"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-foreground">{s.header}</span>
                  <Samples values={sourceSamples.get(s.name) ?? []} />
                </span>
                <span className="xl:col-span-4">
                  Ingår i steg {flow.consumedBy[s.rename]! - headSteps(state).length + 1}. Ta bort
                  steget för att ändra kolumnen.
                </span>
              </li>
            ))}
            {removed.map((s) => (
              <li
                key={s.name}
                className={cn("flex flex-col gap-2 bg-ljusgra-100/60 px-5 py-3 text-sm", GRID)}
                data-testid="removed-row"
              >
                <span className="ml-6 flex items-center">
                  <Checkbox
                    checked={false}
                    disabled={s.locked}
                    aria-label={`Behåll kolumnen ${s.header}`}
                    onCheckedChange={(v) => edit((st) => setKeep(st, s.name, v === true))}
                    data-testid="keep-checkbox"
                  />
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium text-antracit-300 line-through decoration-antracit-200">
                    {s.header}
                  </span>
                  {s.personal ? <Badge tone="personal">Personuppgift</Badge> : null}
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground xl:col-span-4">
                  {s.locked ? (
                    <>
                      <Lock aria-hidden="true" className="size-3.5" />
                      Personnummer sparas aldrig.
                    </>
                  ) : (
                    "Tas inte med. Värdena läses aldrig in."
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function SortableRow({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="flex size-6 cursor-grab items-center justify-center rounded text-antracit-200 hover:text-antracit focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
      aria-label={`Flytta kolumnen ${id}`}
      {...attributes}
      {...listeners}
      data-testid="drag-handle"
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "grid grid-cols-1 gap-3 bg-card px-5 py-4 sm:grid-cols-2",
        GRID,
        isDragging && "relative z-10 shadow-soft",
      )}
      data-testid="column-row"
    >
      {children(handle)}
    </li>
  );
}
