"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { updateAccountGroupAction } from "@/app/(app)/installningar/actions";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccountGroup } from "@/lib/contracts/metric-query";
import {
  MAX_RANGES,
  SIGN_HELP,
  SIGN_LABELS,
  budgetLeafWarnings,
  checkRanges,
  formatRange,
  rangesChanged,
  summaryGroupNote,
  type RangeDraft,
} from "@/lib/settings-ui/account-groups";
import { ConfirmDialog } from "./ConfirmDialog";
import { ERROR_TEXT, Field, NativeSelect, Notice, SettingsCard, describedBy } from "./ui";
import { useSettingsAction } from "./use-settings-action";

export interface AccountGroupsEditorProps {
  groups: AccountGroup[];
  usedBy: Record<string, { key: string; name: string }[]>;
}

export function AccountGroupsEditor({ groups, usedBy }: AccountGroupsEditorProps) {
  return (
    <div className="flex flex-col gap-6">
      <Notice tone="warning">
        <p className="font-medium">Ändringar gäller all historik.</p>
        <p className="mt-1">
          Bokföringsmåtten räknas om direkt för alla månader, i översikten och i nya rapporter.
          Frysta styrelserapporter behåller sina siffror.
        </p>
      </Notice>
      <div className="grid gap-6 xl:grid-cols-2">
        {groups.map((g) => (
          <AccountGroupCard
            key={`${g.key}:${g.name}:${g.sign}:${g.ranges.map(formatRange).join(",")}`}
            group={g}
            groups={groups}
            usedBy={usedBy[g.key] ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function AccountGroupCard({
  group,
  groups,
  usedBy,
}: {
  group: AccountGroup;
  /** All groups: nesting decides which ones the budget is read from. */
  groups: AccountGroup[];
  usedBy: { key: string; name: string }[];
}) {
  const id = useId();
  const [name, setName] = useState(group.name);
  const [sign, setSign] = useState<1 | -1>(group.sign);
  const [ranges, setRanges] = useState<RangeDraft[]>(() =>
    group.ranges.map((r) => ({ from: String(r.from), to: String(r.to) })),
  );
  const [confirming, setConfirming] = useState(false);
  const { pending, run } = useSettingsAction();

  const check = checkRanges(ranges);
  const nameError = name.trim() === "" ? "Kontogruppen måste ha ett namn." : null;
  const dirty =
    name.trim() !== group.name || sign !== group.sign || rangesChanged(group.ranges, ranges);
  const valid = check.errors.length === 0 && !nameError;
  // Ranges inside another group's make the outer group a summary group in the budget.
  const leafWarnings =
    check.errors.length === 0 && rangesChanged(group.ranges, ranges)
      ? budgetLeafWarnings(groups, group.key, check.ranges)
      : [];
  const summaryNote = summaryGroupNote(groups, group.key);

  const setRange = (i: number, patch: Partial<RangeDraft>) =>
    setRanges((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save() {
    setConfirming(false);
    run(updateAccountGroupAction, { key: group.key, name, sign, ranges: check.ranges });
  }

  function undo() {
    setName(group.name);
    setSign(group.sign);
    setRanges(group.ranges.map((r) => ({ from: String(r.from), to: String(r.to) })));
  }

  return (
    <SettingsCard className="flex flex-col gap-5" data-testid={`account-group-${group.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading level={3}>{group.name}</Heading>
        <code className="text-xs text-muted-foreground">{group.key}</code>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-name`} label="Namn" error={nameError}>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy(`${id}-name`, { error: nameError })}
            data-testid="account-group-name"
          />
        </Field>
        <Field id={`${id}-sign`} label="Tecken" hint={SIGN_HELP}>
          <NativeSelect
            id={`${id}-sign`}
            value={String(sign)}
            onChange={(e) => setSign(e.target.value === "-1" ? -1 : 1)}
            aria-describedby={`${id}-sign-hint`}
            data-testid="account-group-sign"
          >
            <option value="1">{SIGN_LABELS[1]}</option>
            <option value="-1">{SIGN_LABELS[-1]}</option>
          </NativeSelect>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Kontointervall</legend>
        {ranges.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2" data-testid="account-range">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-from-${i}`} className="text-xs text-muted-foreground">
                Från konto
              </label>
              <Input
                id={`${id}-from-${i}`}
                value={r.from}
                onChange={(e) => setRange(i, { from: e.target.value })}
                inputMode="numeric"
                maxLength={4}
                className="num w-24"
                data-testid="account-range-from"
              />
            </div>
            <span aria-hidden="true" className="pb-1.5 text-muted-foreground">
              –
            </span>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-to-${i}`} className="text-xs text-muted-foreground">
                Till konto
              </label>
              <Input
                id={`${id}-to-${i}`}
                value={r.to}
                onChange={(e) => setRange(i, { to: e.target.value })}
                inputMode="numeric"
                maxLength={4}
                className="num w-24"
                data-testid="account-range-to"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={ranges.length === 1}
              onClick={() => setRanges((rs) => rs.filter((_, j) => j !== i))}
              aria-label={`Ta bort intervall ${i + 1}`}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={ranges.length >= MAX_RANGES}
          onClick={() => setRanges((rs) => [...rs, { from: "", to: "" }])}
          data-testid="account-range-add"
        >
          <Plus aria-hidden="true" />
          Lägg till intervall
        </Button>
        <div aria-live="polite" className="flex flex-col gap-1 text-xs">
          {check.errors.map((e) => (
            <p key={e} className={ERROR_TEXT}>
              {e}
            </p>
          ))}
          {check.warnings.map((w) => (
            <p key={w} className="text-muted-foreground">
              {w}
            </p>
          ))}
        </div>
        {leafWarnings.length > 0 ? (
          <Notice tone="warning" className="text-xs" data-testid="account-group-nesting">
            <p className="font-medium">Budgeten läses på ett annat sätt efter ändringen.</p>
            {leafWarnings.map((w) => (
              <p key={w} className="mt-1">
                {w}
              </p>
            ))}
          </Notice>
        ) : null}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        {usedBy.length > 0
          ? `Används av måttet ${usedBy.map((m) => `”${m.name}”`).join(", ")}.`
          : "Inget mått använder kontogruppen än (den kan användas i budgeten)."}
        {summaryNote ? ` ${summaryNote}` : null}
      </p>

      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Spara och räkna om historiken?"
          description={
            <>
              <p>
                ”{name.trim()}” räknas om för alla månader med de nya inställningarna:{" "}
                {check.ranges.map(formatRange).join(", ")}, tecken {sign === 1 ? "+" : "−"}.
              </p>
              {leafWarnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <p>Frysta styrelserapporter påverkas inte.</p>
            </>
          }
          confirmLabel="Spara"
          onConfirm={save}
          testId="account-group-confirm"
        />
        <Button
          disabled={!dirty || !valid || pending}
          onClick={() => setConfirming(true)}
          data-testid="account-group-save"
        >
          {pending ? "Sparar…" : "Spara"}
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={undo} disabled={pending}>
            Ångra ändringar
          </Button>
        ) : null}
      </div>
    </SettingsCard>
  );
}
