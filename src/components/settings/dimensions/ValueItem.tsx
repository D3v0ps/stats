"use client";

import { Plus, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeValue } from "@/lib/core/normalize";
import type { ValueRow } from "@/lib/settings-ui/dimensions";
import { cn } from "@/lib/utils";

export interface ValueItemProps {
  row: ValueRow;
  disabled: boolean;
  onRename: (label: string) => void;
  onSetActive: (active: boolean) => void;
  onAddAlias: (alias: string) => void;
  onRemoveAlias: (alias: string) => void;
  onMerge: () => void;
}

/** One dimension value: name (rename inline), code, aliases and actions. */
export function ValueItem({
  row,
  disabled,
  onRename,
  onSetActive,
  onAddAlias,
  onRemoveAlias,
  onMerge,
}: ValueItemProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(row.label);
  const [alias, setAlias] = useState("");
  const [addingAlias, setAddingAlias] = useState(false);
  const showCode = row.code !== normalizeValue(row.label);
  const renameButton = useRef<HTMLButtonElement>(null);
  const aliasButton = useRef<HTMLButtonElement>(null);

  // The inline forms replace the button that opened them; give focus back to that button when
  // they close, so keyboard users do not land at the top of the page.
  const refocus = (button: RefObject<HTMLButtonElement | null>) =>
    requestAnimationFrame(() => button.current?.focus());

  function stopEditing() {
    setEditing(false);
    setLabel(row.label);
    refocus(renameButton);
  }

  function stopAddingAlias() {
    setAddingAlias(false);
    setAlias("");
    refocus(aliasButton);
  }

  function saveLabel(event: FormEvent) {
    event.preventDefault();
    const next = label.trim();
    stopEditing();
    if (next !== "" && next !== row.label) onRename(next);
  }

  function cancelOnEscape(event: KeyboardEvent, reset: () => void) {
    if (event.key === "Escape") {
      event.preventDefault();
      reset();
    }
  }

  function saveAlias(event: FormEvent) {
    event.preventDefault();
    const next = alias.trim();
    if (next === "") return;
    stopAddingAlias();
    onAddAlias(next);
  }

  return (
    <li
      className={cn("flex flex-col gap-3 py-4", !row.active && "opacity-70")}
      data-testid={`value-row-${row.id}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {editing ? (
            <form onSubmit={saveLabel} className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-label`} className="sr-only">
                Nytt namn för {row.label}
              </label>
              <Input
                id={`${id}-label`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => cancelOnEscape(e, stopEditing)}
                maxLength={200}
                autoFocus
                className="w-64 max-w-full"
                data-testid="value-label-input"
              />
              <Button type="submit" size="sm" data-testid="value-label-save">
                Spara
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={stopEditing}>
                Avbryt
              </Button>
            </form>
          ) : (
            <p className="font-medium break-words">
              {row.label}
              {!row.active ? (
                <span className="ml-2 rounded-full bg-ljusgra-200 px-2 py-0.5 align-middle text-xs font-normal">
                  Inaktiv
                </span>
              ) : null}
            </p>
          )}
          {showCode ? (
            <p className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{row.code}</span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <Button
              ref={renameButton}
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setLabel(row.label);
                setEditing(true);
              }}
              aria-label={`Byt namn på ${row.label}`}
              data-testid="value-rename"
            >
              Byt namn
            </Button>
          ) : null}
          {row.active ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={onMerge}
              aria-label={`Slå ihop ${row.label} med ett annat värde`}
              data-testid="value-merge"
            >
              Slå ihop…
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onSetActive(!row.active)}
            aria-label={`${row.active ? "Inaktivera" : "Aktivera"} ${row.label}`}
            data-testid="value-toggle-active"
          >
            {row.active ? "Inaktivera" : "Aktivera"}
          </Button>
        </div>
      </div>

      <div
        role="group"
        className="flex flex-wrap items-center gap-2"
        aria-label={`Alias för ${row.label}`}
      >
        <span className="text-xs text-muted-foreground">Alias:</span>
        {row.aliases.length === 0 && !addingAlias ? (
          <span className="text-xs text-muted-foreground">inga</span>
        ) : null}
        {row.aliases.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-bla-100 py-0.5 pr-1 pl-2.5 text-xs text-antracit"
            data-testid="value-alias"
          >
            {a}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemoveAlias(a)}
              aria-label={`Ta bort aliaset ${a}`}
              className="rounded-full p-0.5 hover:bg-bla-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        {addingAlias ? (
          <form onSubmit={saveAlias} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-alias`} className="sr-only">
              Nytt alias för {row.label}
            </label>
            <Input
              id={`${id}-alias`}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              onKeyDown={(e) => cancelOnEscape(e, stopAddingAlias)}
              placeholder="Annan stavning eller kod"
              maxLength={200}
              autoFocus
              className="h-7 w-52 max-w-full text-sm"
              data-testid="value-alias-input"
            />
            <Button type="submit" size="sm" data-testid="value-alias-save">
              Lägg till
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={stopAddingAlias}>
              Avbryt
            </Button>
          </form>
        ) : (
          <Button
            ref={aliasButton}
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => setAddingAlias(true)}
            aria-label={`Lägg till alias för ${row.label}`}
            data-testid="value-alias-add"
          >
            <Plus aria-hidden="true" />
            Alias
          </Button>
        )}
      </div>
    </li>
  );
}
