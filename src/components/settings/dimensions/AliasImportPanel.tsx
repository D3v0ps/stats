"use client";

import { FileSpreadsheet } from "lucide-react";
import { useId, useMemo, useState, type ChangeEvent } from "react";
import { applyAliasImportAction } from "@/app/(app)/installningar/actions";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";
import type { DetectedTable, RawCell } from "@/lib/contracts/workbook";
import { formatNumber } from "@/lib/core/format-sv";
import { redactPersonnummer } from "@/lib/core/pnr";
import { fail, ok, type ActionResult } from "@/lib/settings-ui/action-result";
import {
  APPLIED_STATUSES,
  FLAGGED_STATUSES,
  MAX_IMPORT_PAIRS,
  MODE_LABELS,
  STATUS_LABELS,
  batchPairs,
  canCreateValues,
  columnChoiceError,
  defaultMode,
  extractPairs,
  importSummary,
  partialImportError,
  planAliasImport,
  type AliasImportMode,
  type ImportPair,
  type PlanStatus,
} from "@/lib/settings-ui/alias-import";
import type { UnknownPolicy, ValueRow } from "@/lib/settings-ui/dimensions";
import { cn } from "@/lib/utils";
import { ERROR_TEXT, NativeSelect, Notice, SettingsCard } from "../ui";
import { useSettingsAction } from "../use-settings-action";

/** Files above this size are refused before reading (a lookup list is small). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PREVIEW_ROWS = 200;

interface LoadedFile {
  fileName: string;
  table: DetectedTable;
  cellText: (cell: RawCell | undefined) => string;
}

export interface AliasImportPanelProps {
  dimension: { key: string; label: string; personal: boolean; policy: UnknownPolicy };
  rows: ValueRow[];
}

const MODE_HELP: Record<AliasImportMode, string> = {
  alias:
    "Till ska vara ett värde som redan finns (namn, kod eller alias). Från blir ett alias, så framtida filer med Från räknas som Till.",
  relabel:
    "Från ska vara ett värde som redan finns (till exempel anställnings-id). Värdet får Till som visningsnamn; koden är kvar så att importer fortsätter att hitta det.",
};

interface ImportRequest {
  dimensionKey: string;
  mode: AliasImportMode;
  pairs: ImportPair[];
}

/** Sends a long list in batches (server action bodies are capped at 1 MB), one at a time. */
async function applyInBatches(
  request: ImportRequest,
): Promise<ActionResult<{ applied: number; flagged: number }>> {
  let applied = 0;
  let flagged = 0;
  for (const pairs of batchPairs(request.pairs)) {
    const result = await applyAliasImportAction({ ...request, pairs });
    if (!result.ok) return fail(partialImportError(result.error, applied));
    applied += result.data.applied;
    flagged += result.data.flagged;
  }
  return ok(importSummary(applied, flagged), { applied, flagged });
}

function statusTone(status: PlanStatus): string {
  if (APPLIED_STATUSES.has(status)) return "bg-bla-100";
  if (FLAGGED_STATUSES.has(status)) return "bg-rod-100";
  return "bg-ljusgra-200";
}

export function AliasImportPanel({ dimension, rows }: AliasImportPanelProps) {
  const id = useId();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [fromColumn, setFromColumn] = useState(0);
  const [toColumn, setToColumn] = useState(1);
  const [headerIsData, setHeaderIsData] = useState(false);
  const [mode, setMode] = useState<AliasImportMode>(() => defaultMode(dimension.key));
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const { pending, run } = useSettingsAction();

  const context = useMemo(
    () => ({
      dimensionKey: dimension.key,
      policy: dimension.policy,
      values: rows.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        sort: 0,
        active: r.active,
      })),
      aliases: rows.flatMap((r) => r.aliases.map((a) => ({ aliasNorm: a, valueId: r.id }))),
    }),
    [dimension.key, dimension.policy, rows],
  );
  const extraction = useMemo(
    () =>
      file
        ? extractPairs(file.table, fromColumn, toColumn, { headerIsData, cellText: file.cellText })
        : null,
    [file, fromColumn, toColumn, headerIsData],
  );
  const tooMany = (extraction?.pairs.length ?? 0) > MAX_IMPORT_PAIRS;
  const columnError = columnChoiceError(fromColumn, toColumn);
  const plan = useMemo(
    () =>
      extraction && !tooMany && !columnError
        ? planAliasImport(extraction.pairs, mode, context)
        : null,
    [extraction, tooMany, columnError, mode, context],
  );
  const shownRows = (plan?.rows ?? []).filter(
    (r) => !onlyFlagged || FLAGGED_STATUSES.has(r.status),
  );

  function reset() {
    setFile(null);
    setReadError(null);
    setOnlyFlagged(false);
    setInputKey((k) => k + 1);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setReadError(null);
    setFile(null);
    if (picked.size > MAX_FILE_BYTES) {
      setReadError("Filen är för stor. En uppslagslista brukar vara under några megabyte.");
      return;
    }
    setReading(true);
    try {
      // The readers (SheetJS) load only when a file is picked.
      const ingest = await import("@/lib/ingest");
      const workbook = ingest.readWorkbook(new Uint8Array(await picked.arrayBuffer()), picked.name);
      const sheet = ingest.pickSheet(workbook);
      if (!sheet) {
        setReadError("Filen innehåller inget kalkylblad.");
        return;
      }
      const table = ingest.detectTable(sheet);
      if (table.columns.length < 2) {
        setReadError("Filen behöver minst två kolumner: Från och Till.");
        return;
      }
      setFromColumn(0);
      setToColumn(1);
      setHeaderIsData(false);
      setFile({ fileName: picked.name, table, cellText: ingest.cellText });
    } catch (error) {
      setReadError(
        error instanceof Error && error.name === "ReadError"
          ? error.message
          : "Filen kunde inte läsas. Spara den som .xlsx eller .csv och försök igen.",
      );
    } finally {
      setReading(false);
    }
  }

  function apply() {
    if (!plan || !extraction) return;
    const pairs = plan.rows
      .filter((r) => APPLIED_STATUSES.has(r.status))
      .map((r) => ({ row: r.row, from: r.from, to: r.to }));
    if (pairs.length === 0) return;
    run(applyInBatches, { dimensionKey: dimension.key, mode, pairs }, { onSuccess: reset });
  }

  const columns = file?.table.columns ?? [];

  return (
    <SettingsCard className="flex flex-col gap-5" data-testid="alias-import">
      <div className="flex flex-col gap-2">
        <Heading level={3}>Fyll från Excel</Heading>
        <p className="max-w-prose text-sm text-muted-foreground">
          Lägg till många alias eller namn på en gång från en fil med två kolumner, Från och Till.
          Till exempel kundkod → kundnamn, en felstavning → rätt kund, eller anställnings-id → namn.
          Filen läses i webbläsaren och sparas inte.
        </p>
        {dimension.personal ? (
          <Notice>
            Namn är personuppgifter. De sparas bara som visningsnamn, används i arbetsytan och syns
            aldrig i styrelserapporter. Rader med personnummer tas inte emot.
          </Notice>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={`${id}-file`}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted"
        >
          <FileSpreadsheet aria-hidden="true" className="size-4" />
          {file ? "Välj en annan fil" : "Välj fil"}
        </label>
        <input
          key={inputKey}
          id={`${id}-file`}
          type="file"
          accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          onChange={onFile}
          className="sr-only"
          data-testid="alias-import-file"
        />
        {reading ? <span className="text-sm text-muted-foreground">Läser filen…</span> : null}
        {file ? (
          <span className="text-sm">
            {file.fileName} · {formatNumber(file.table.rows.length)} rader
          </span>
        ) : null}
      </div>
      {readError ? (
        <p role="alert" className={cn(ERROR_TEXT, "text-sm")}>
          {readError}
        </p>
      ) : null}

      {file && extraction ? (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-from`} className="text-sm font-medium">
                Från-kolumn
              </label>
              <NativeSelect
                id={`${id}-from`}
                value={fromColumn}
                onChange={(e) => setFromColumn(Number(e.target.value))}
                data-testid="alias-import-from"
              >
                {columns.map((c, i) => (
                  <option key={c.index} value={i}>
                    {redactPersonnummer(c.header)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-to`} className="text-sm font-medium">
                Till-kolumn
              </label>
              <NativeSelect
                id={`${id}-to`}
                value={toColumn}
                onChange={(e) => setToColumn(Number(e.target.value))}
                data-testid="alias-import-to"
              >
                {columns.map((c, i) => (
                  <option key={c.index} value={i}>
                    {redactPersonnummer(c.header)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {columnError ? (
            <p role="alert" className={cn(ERROR_TEXT, "text-sm")}>
              {columnError}
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={headerIsData}
              onChange={(e) => setHeaderIsData(e.target.checked)}
              className="size-4 accent-antracit"
            />
            Första raden är data, inte rubriker
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Vad betyder kolumnerna?</legend>
            {(Object.keys(MODE_LABELS) as AliasImportMode[]).map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm has-checked:border-antracit has-checked:bg-ljusgra-100"
              >
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="mt-0.5 size-4 accent-antracit"
                  data-testid={`alias-import-mode-${m}`}
                />
                <span className="flex flex-col gap-1">
                  <span className="font-medium">{MODE_LABELS[m]}</span>
                  <span className="text-xs text-muted-foreground">{MODE_HELP[m]}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              {canCreateValues(context)
                ? "Värden som saknas skapas automatiskt."
                : "Värden som saknas skapas inte här – de flaggas som okända."}
            </p>
          </fieldset>

          {tooMany ? (
            <p role="alert" className={cn(ERROR_TEXT, "text-sm")}>
              Filen har {formatNumber(extraction.pairs.length)} rader. Högst{" "}
              {formatNumber(MAX_IMPORT_PAIRS)} per import – dela upp filen.
            </p>
          ) : null}

          {plan ? (
            <div className="flex flex-col gap-4" data-testid="alias-import-preview">
              <ul className="flex flex-wrap gap-2" aria-label="Sammanfattning">
                {(Object.entries(plan.counts) as [PlanStatus, number][])
                  .filter(([, n]) => n > 0)
                  .map(([status, n]) => (
                    <li
                      key={status}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs text-antracit",
                        statusTone(status),
                      )}
                      data-testid={`alias-import-count-${status}`}
                    >
                      {STATUS_LABELS[status]}: {formatNumber(n)}
                    </li>
                  ))}
                {extraction.emptyRows > 0 ? (
                  <li className="rounded-full bg-ljusgra-200 px-3 py-1 text-xs text-antracit">
                    Tomma rader: {formatNumber(extraction.emptyRows)}
                  </li>
                ) : null}
              </ul>

              {plan.flagged > 0 ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={onlyFlagged}
                    onChange={(e) => setOnlyFlagged(e.target.checked)}
                    className="size-4 accent-antracit"
                  />
                  Visa bara rader som behöver ses över ({formatNumber(plan.flagged)})
                </label>
              ) : null}

              <div className="max-h-[28rem] overflow-auto rounded-xl border">
                <table className="w-full min-w-[40rem] text-sm">
                  <caption className="sr-only">Förhandsgranskning av filen</caption>
                  <thead className="sticky top-0 bg-ljusgra-100 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Rad
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Från
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Till
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Resultat
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.slice(0, PREVIEW_ROWS).map((r, i) => (
                      <tr key={`${i}-${r.row}`} className="border-t align-top">
                        <td className="num px-3 py-2 text-muted-foreground">{r.row}</td>
                        <td className="px-3 py-2 break-words">
                          {r.from ? redactPersonnummer(r.from) : "–"}
                        </td>
                        <td className="px-3 py-2 break-words">
                          {r.to ? redactPersonnummer(r.to) : "–"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "mr-2 inline-block rounded-full px-2 py-0.5 text-xs text-antracit",
                              statusTone(r.status),
                            )}
                          >
                            {STATUS_LABELS[r.status]}
                          </span>
                          <span className="text-xs text-muted-foreground">{r.message}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shownRows.length > PREVIEW_ROWS ? (
                <p className="text-xs text-muted-foreground">
                  Visar de första {formatNumber(PREVIEW_ROWS)} av {formatNumber(shownRows.length)}{" "}
                  raderna.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={apply}
                  disabled={pending || plan.applicable === 0}
                  data-testid="alias-import-apply"
                >
                  {pending
                    ? "Sparar…"
                    : plan.applicable === 0
                      ? "Inget att lägga till"
                      : `Spara ${formatNumber(plan.applicable)} ${plan.applicable === 1 ? "ändring" : "ändringar"}`}
                </Button>
                <Button variant="ghost" onClick={reset} disabled={pending}>
                  Avbryt
                </Button>
                {plan.flagged > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Flaggade rader sparas inte. Rätta filen och läs in den igen.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </SettingsCard>
  );
}
