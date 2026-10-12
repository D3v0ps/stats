"use client";

import { useId, useState } from "react";
import { setThresholdAction } from "@/app/(app)/installningar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/core/format-sv";
import { parsePercentInput, percentInputText } from "@/lib/settings-ui/metrics";
import { Field, SettingsCard, describedBy } from "./ui";
import { useSettingsAction } from "./use-settings-action";

const MAX_PCT = 1000;

export function ThresholdForm({ value, defaultValue }: { value: number; defaultValue: number }) {
  const id = useId();
  const [text, setText] = useState(() => percentInputText(value));
  const { pending, run } = useSettingsAction();
  const pct = parsePercentInput(text);
  const error =
    pct === null || pct <= 0 || pct > MAX_PCT
      ? `Skriv ett tal större än 0 och högst ${formatNumber(MAX_PCT)}.`
      : null;
  const dirty = pct !== value;
  const example = pct !== null && !error ? pct : value;

  return (
    <SettingsCard className="max-w-2xl">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (pct !== null && !error) run(setThresholdAction, { pct });
        }}
      >
        <Field
          id={`${id}-pct`}
          label="Avvikelsegräns (%)"
          error={text.trim() === "" ? null : error}
          hint={`När en uppladdning granskas flaggas ett mått vars värde ändras med minst så här mycket mot föregående månad. Med ${formatNumber(example, Number.isInteger(example) ? 0 : 1)} % flaggas till exempel en ökning från 100 till ${formatNumber(100 + example, Number.isInteger(example) ? 0 : 1)}. Standard är ${formatNumber(defaultValue)} %.`}
        >
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-pct`}
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="num w-28"
              aria-invalid={error && text.trim() !== "" ? true : undefined}
              aria-describedby={describedBy(`${id}-pct`, { hint: true, error })}
              data-testid="review-threshold"
            />
            <span aria-hidden="true" className="text-sm text-muted-foreground">
              %
            </span>
          </div>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={!dirty || Boolean(error) || pending}
            data-testid="review-save"
          >
            {pending ? "Sparar…" : "Spara"}
          </Button>
          {value !== defaultValue ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setText(percentInputText(defaultValue))}
            >
              Återställ till {formatNumber(defaultValue)} %
            </Button>
          ) : null}
        </div>
      </form>
    </SettingsCard>
  );
}
