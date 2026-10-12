"use client";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/core/format-sv";
import { existingValues, type DictionaryEntry, type UnknownGroup } from "@/lib/import-ui/review";
import { NativeSelect } from "../fields";

/** Values the catalog does not know yet: add as new, or say it is the same as an existing one. */
export function UnknownValues({
  groups,
  dictionary,
  busy,
  onAddNew,
  onAddAll,
  onSameAs,
}: {
  groups: UnknownGroup[];
  dictionary: Record<string, DictionaryEntry>;
  busy: boolean;
  onAddNew: (dimension: string, label: string) => void;
  onAddAll: (dimension: string, labels: string[]) => void;
  onSameAs: (dimension: string, label: string, valueId: number) => void;
}) {
  const asking = groups.filter((g) => g.ask.length > 0);
  if (asking.length === 0) return null;
  return (
    <div className="flex flex-col gap-5" data-testid="unknown-values">
      <p className="text-sm">
        Några värden finns inte i katalogen ännu. Lägg till dem som nya, eller välj vilket
        befintligt värde de är samma som – då känns stavningen igen nästa gång.
      </p>
      {asking.map((g) => {
        const existing = existingValues(dictionary[g.dimension]).map((v) => ({
          value: String(v.id),
          label: v.label,
        }));
        return (
          <div key={g.dimension} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium tracking-[0.06em] uppercase">
                {g.label}{" "}
                <span className="num font-normal text-muted-foreground">
                  ({formatNumber(g.ask.length)} nya)
                </span>
              </p>
              {g.ask.length > 1 && !g.personal ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onAddAll(g.dimension, g.ask)}
                >
                  Lägg till alla som nya
                </Button>
              ) : null}
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {g.ask.map((label) => (
                <li
                  key={label}
                  className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    title={g.personal ? undefined : label}
                  >
                    {g.personal ? "Personuppgift" : label}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => onAddNew(g.dimension, label)}
                      data-testid="add-new-value"
                    >
                      Lägg till som ny
                    </Button>
                    {existing.length > 0 ? (
                      <NativeSelect
                        aria-label={`${label} är samma som`}
                        className="w-56"
                        value=""
                        placeholder="Samma som…"
                        options={existing}
                        disabled={busy}
                        onChange={(e) =>
                          e.target.value && onSameAs(g.dimension, label, Number(e.target.value))
                        }
                        data-testid="same-as-select"
                      />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
