"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useOptimistic, useState } from "react";
import {
  addAliasAction,
  deleteAliasAction,
  mergeValuesAction,
  renameValueAction,
  setValueActiveAction,
} from "@/app/(app)/installningar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/core/format-sv";
import {
  applyValuePatch,
  filterValueRows,
  type ValuePatch,
  type ValueRow,
} from "@/lib/settings-ui/dimensions";
import { SettingsCard } from "../ui";
import { useSettingsAction } from "../use-settings-action";
import { MergeDialog } from "./MergeDialog";
import { ValueItem } from "./ValueItem";

const PAGE = 100;

export interface DimensionValuesEditorProps {
  dimension: { key: string; label: string; personal: boolean };
  /** Sorted on the server (buildValueRows). */
  rows: ValueRow[];
}

export function DimensionValuesEditor({ dimension, rows }: DimensionValuesEditorProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [merging, setMerging] = useState<ValueRow | null>(null);
  const [optimisticRows, applyOptimistic] = useOptimistic(rows, applyValuePatch);
  const { pending, run } = useSettingsAction();

  const filtered = useMemo(
    () => filterValueRows(optimisticRows, query, { showInactive }),
    [optimisticRows, query, showInactive],
  );
  const visible = filtered.slice(0, limit);
  const inactiveCount = optimisticRows.filter((r) => !r.active).length;

  const apply = (patch: ValuePatch) => () => applyOptimistic(patch);

  const handlers = {
    rename: (row: ValueRow, label: string) =>
      run(
        renameValueAction,
        { id: row.id, label },
        { optimistic: apply({ kind: "label", id: row.id, label }) },
      ),
    setActive: (row: ValueRow, active: boolean) =>
      run(
        setValueActiveAction,
        { id: row.id, active },
        { optimistic: apply({ kind: "active", id: row.id, active }) },
      ),
    addAlias: (row: ValueRow, alias: string) =>
      run(
        addAliasAction,
        { dimensionKey: dimension.key, alias, valueId: row.id },
        { optimistic: apply({ kind: "alias_add", id: row.id, alias }) },
      ),
    removeAlias: (alias: string) =>
      run(
        deleteAliasAction,
        { dimensionKey: dimension.key, alias },
        { optimistic: apply({ kind: "alias_remove", alias }) },
      ),
  };

  function merge(from: ValueRow, into: ValueRow) {
    setMerging(null);
    run(
      mergeValuesAction,
      { fromId: from.id, intoId: into.id },
      { optimistic: apply({ kind: "merge", fromId: from.id, intoId: into.id }) },
    );
  }

  return (
    <SettingsCard className="flex flex-col gap-5" aria-busy={pending || undefined}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex w-full max-w-md flex-col gap-1.5">
          <label htmlFor={`${id}-search`} className="text-sm font-medium">
            Sök bland värden
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-antracit-200"
            />
            <Input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Namn, kod eller alias"
              className="pl-8"
              data-testid="dimension-search"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4 accent-antracit"
            data-testid="dimension-show-inactive"
          />
          Visa inaktiva ({formatNumber(inactiveCount)})
        </label>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtered.length === optimisticRows.length
          ? `${formatNumber(filtered.length)} värden`
          : `${formatNumber(filtered.length)} av ${formatNumber(optimisticRows.length)} värden`}
        {dimension.personal
          ? " · Namnen syns bara här och i arbetsytan, aldrig i styrelserapporter."
          : ""}
      </p>

      {visible.length === 0 ? (
        <p className="rounded-xl bg-ljusgra-100 px-4 py-6 text-center text-sm text-muted-foreground">
          {optimisticRows.length === 0
            ? "Inga värden ännu. De skapas när filer laddas upp, eller med ”Fyll från Excel” nedan."
            : "Inga värden matchar sökningen."}
        </p>
      ) : (
        <ul className="divide-y divide-border" data-testid="dimension-values">
          {visible.map((row) => (
            <ValueItem
              key={row.id}
              row={row}
              disabled={pending}
              onRename={(label) => handlers.rename(row, label)}
              onSetActive={(active) => handlers.setActive(row, active)}
              onAddAlias={(alias) => handlers.addAlias(row, alias)}
              onRemoveAlias={handlers.removeAlias}
              onMerge={() => setMerging(row)}
            />
          ))}
        </ul>
      )}

      {filtered.length > visible.length ? (
        <Button variant="outline" className="self-center" onClick={() => setLimit((n) => n + PAGE)}>
          Visa fler ({formatNumber(filtered.length - visible.length)} till)
        </Button>
      ) : null}

      <MergeDialog
        from={merging}
        candidates={optimisticRows}
        dimensionLabel={dimension.label}
        onCancel={() => setMerging(null)}
        onConfirm={merge}
      />
    </SettingsCard>
  );
}
