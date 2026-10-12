"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/core/format-sv";
import { filterValueRows, type ValueRow } from "@/lib/settings-ui/dimensions";

const SHOWN = 50;

export interface MergeDialogProps {
  /** The value to merge away; null closes the dialog. */
  from: ValueRow | null;
  candidates: readonly ValueRow[];
  dimensionLabel: string;
  onCancel: () => void;
  onConfirm: (from: ValueRow, into: ValueRow) => void;
}

/** Pick the value to keep, then confirm: facts move, the old value becomes an alias. */
export function MergeDialog({
  from,
  candidates,
  dimensionLabel,
  onCancel,
  onConfirm,
}: MergeDialogProps) {
  return (
    <Dialog open={from !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90dvh] gap-5 overflow-y-auto p-5 sm:max-w-lg"
        data-testid="merge-dialog"
      >
        {from ? (
          <MergeForm
            key={from.id}
            from={from}
            candidates={candidates}
            dimensionLabel={dimensionLabel}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MergeForm({
  from,
  candidates,
  dimensionLabel,
  onCancel,
  onConfirm,
}: Omit<MergeDialogProps, "from"> & { from: ValueRow }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [intoId, setIntoId] = useState<number | null>(null);
  const options = useMemo(
    () =>
      filterValueRows(candidates, query, { showInactive: false }).filter((r) => r.id !== from.id),
    [candidates, query, from.id],
  );
  const into = candidates.find((r) => r.id === intoId) ?? null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base font-medium tracking-[0.08em] uppercase">
          Slå ihop värden
        </DialogTitle>
        <DialogDescription>
          Välj vilket värde i {dimensionLabel.toLocaleLowerCase("sv")} som ”{from.label}” ska slås
          ihop med.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-search`} className="text-sm font-medium">
          Sök värde att behålla
        </label>
        <Input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Namn, kod eller alias"
          data-testid="merge-search"
        />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Värde att behålla</legend>
        <div className="max-h-64 overflow-y-auto rounded-xl border">
          {options.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Inga andra värden matchar.</p>
          ) : (
            options.slice(0, SHOWN).map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 has-checked:bg-bla-100"
              >
                <input
                  type="radio"
                  name={`${id}-into`}
                  value={r.id}
                  checked={intoId === r.id}
                  onChange={() => setIntoId(r.id)}
                  className="size-4 accent-antracit"
                  data-testid="merge-option"
                />
                <span className="min-w-0 break-words">{r.label}</span>
              </label>
            ))
          )}
        </div>
        {options.length > SHOWN ? (
          <p className="text-xs text-muted-foreground">
            Visar {formatNumber(SHOWN)} av {formatNumber(options.length)}. Sök för att hitta fler.
          </p>
        ) : null}
      </fieldset>

      {into ? (
        <div className="rounded-xl bg-ljusgra-100 px-4 py-3 text-sm" aria-live="polite">
          <p>
            Alla siffror för <strong>”{from.label}”</strong> flyttas till{" "}
            <strong>”{into.label}”</strong>. ”{from.label}” blir ett alias och inaktiveras, så
            framtida filer hamnar också på ”{into.label}”.
          </p>
          <p className="mt-2 font-medium">Det går inte att ångra.</p>
        </div>
      ) : null}

      <DialogFooter className="-mx-5 -mb-5 flex-row justify-end gap-2 px-5">
        <Button variant="outline" onClick={onCancel}>
          Avbryt
        </Button>
        <Button
          disabled={!into}
          onClick={() => into && onConfirm(from, into)}
          data-testid="merge-confirm"
        >
          Slå ihop
        </Button>
      </DialogFooter>
    </>
  );
}
