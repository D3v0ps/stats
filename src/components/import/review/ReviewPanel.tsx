"use client";

// Review of one file before publishing: months that have not ended are left
// out by default, unknown dimension values are resolved, the upload is staged
// in chunks (progress bar), then compared with published data. Publish or
// discard; nothing is visible to anyone until "Godkänn och publicera".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { FactRow, IngestResult, TemplateConfig } from "@/lib/contracts";
import { COMPANY_FILTER_LABELS } from "@/lib/contracts";
import { formatNumber } from "@/lib/core/format-sv";
import type { ReviewComparison } from "@/lib/db/repo/uploads";
import { progressPercent } from "@/lib/import-ui/chunking";
import { excludeMonths, formatMonthSpan, openMonths, resultMonths } from "@/lib/import-ui/months";
import type { QueueItem } from "@/lib/import-ui/queue";
import {
  buildReviewRows,
  factDimensions,
  publishSummaryText,
  resolveFacts,
  resultMetricKeys,
  templateMetricKeys,
  withResolvedValues,
  type DictionaryEntry,
  type Resolution,
} from "@/lib/import-ui/review";
import {
  buildUploadCreate,
  factChunks,
  ledgerChunks,
  stageTotal,
} from "@/lib/import-ui/upload-payload";
import {
  addAliasAction,
  compareUploadAction,
  createUploadAction,
  discardUploadAction,
  ensureValuesAction,
  publishUploadAction,
  stageFactsAction,
  stageLedgerAction,
} from "@/app/(app)/ladda-upp/actions";
import { Panel, ProgressBar } from "../fields";
import type { UploadCatalog } from "../types";
import { ComparisonTable } from "./ComparisonTable";
import { ReportDetails } from "./ReportDetails";
import { SieChecks } from "./SieChecks";
import { UnknownValues } from "./UnknownValues";

type Phase =
  | { kind: "preparing" }
  | { kind: "values"; resolution: Resolution }
  | { kind: "staging"; done: number; total: number }
  | { kind: "comparing" }
  | { kind: "ready"; comparison: ReviewComparison; uploadId: string; error?: string }
  | { kind: "publishing"; comparison: ReviewComparison; uploadId: string }
  | { kind: "published"; summary: string }
  | { kind: "discarded" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const ENSURE_BATCH = 1000;

export type Publisher = () => Promise<boolean>;

export interface ReviewPanelProps {
  item: QueueItem;
  catalog: UploadCatalog;
  getDictionaries: (keys: readonly string[]) => Promise<Record<string, DictionaryEntry>>;
  rememberValues: (dimension: string, entry: DictionaryEntry) => void;
  onPublished: (id: string, summary: string, publishedAt: string) => void;
  register: (id: string, publish: Publisher | null) => void;
  /** The template the file was read with (null for SIE files). */
  templateConfig?: TemplateConfig;
  onDiscarded?: () => void;
  now: Date;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Något gick fel. Försök igen.";
}

export function ReviewPanel({
  item,
  catalog,
  getDictionaries,
  rememberValues,
  onPublished,
  register,
  templateConfig,
  onDiscarded,
  now,
}: ReviewPanelProps) {
  const result = item.result!;
  const [includeOpen, setIncludeOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>(
    item.status === "published"
      ? { kind: "published", summary: item.summary ?? "" }
      : { kind: "preparing" },
  );
  const [effective, setEffective] = useState<IngestResult | null>(null);
  const [dict, setDict] = useState<Record<string, DictionaryEntry>>({});
  const [busy, setBusy] = useState(false);
  const [restart, setRestart] = useState(0);
  const uploadRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const open = useMemo(() => openMonths(result, now), [result, now]);
  const dimensionLabels = useMemo(
    () => Object.fromEntries(catalog.dimensions.map((d) => [d.key, d.label])),
    [catalog.dimensions],
  );
  const alreadyPublished = item.status === "published";

  /** Abandon the running flow: every step checks its run number before going on. */
  const invalidate = useCallback(() => {
    runRef.current++;
  }, []);

  const discardStaged = useCallback(async () => {
    const id = uploadRef.current;
    uploadRef.current = null;
    if (id) await discardUploadAction({ uploadId: id });
  }, []);

  const stage = useCallback(
    async (run: number, eff: IngestResult, rows: FactRow[] | null) => {
      const template =
        item.template && item.template.kind !== "sie"
          ? { id: item.template.id, version: item.template.version }
          : null;
      const total = stageTotal(eff, rows);
      setPhase({ kind: "staging", done: 0, total });
      const created = await createUploadAction(buildUploadCreate(eff, template));
      if (!created.ok) {
        setPhase({ kind: "error", message: created.error });
        return;
      }
      const uploadId = created.data;
      if (run !== runRef.current) {
        discardUploadAction({ uploadId }).catch(() => undefined);
        return;
      }
      uploadRef.current = uploadId;
      let done = 0;
      const parts = eff.ledger
        ? ledgerChunks(eff.ledger)
        : factChunks(rows ?? []).map((facts) => ({ facts }));
      for (const part of parts) {
        const r =
          "facts" in part
            ? await stageFactsAction({ uploadId, facts: part.facts })
            : await stageLedgerAction({ uploadId, ...part });
        if (run !== runRef.current) return;
        if (!r.ok) {
          await discardStaged();
          setPhase({ kind: "error", message: r.error });
          return;
        }
        done += "facts" in part ? part.facts.length : part.rows.length;
        setPhase({ kind: "staging", done, total });
      }
      setPhase({ kind: "comparing" });
      const cmp = await compareUploadAction({ uploadId });
      if (run !== runRef.current) return;
      if (!cmp.ok) {
        setPhase({ kind: "error", message: cmp.error });
        return;
      }
      setPhase({ kind: "ready", comparison: cmp.data, uploadId });
    },
    [item.template, discardStaged],
  );

  const resolveAndStage = useCallback(
    async (run: number, eff: IngestResult, start: Record<string, DictionaryEntry>) => {
      let current = start;
      let res = resolveFacts(eff.facts, current, dimensionLabels);
      const creates = res.unknown.filter((g) => g.create.length > 0);
      for (const g of creates) {
        for (let i = 0; i < g.create.length; i += ENSURE_BATCH) {
          const r = await ensureValuesAction({
            dimension: g.dimension,
            labels: g.create.slice(i, i + ENSURE_BATCH),
            force: false,
          });
          if (!r.ok) throw new Error(r.error);
          const ids: Record<string, number> = {};
          for (const [label, id] of Object.entries(r.data)) if (id !== null) ids[label] = id;
          current = withResolvedValues(current, g.dimension, ids);
        }
        rememberValues(g.dimension, current[g.dimension]!);
      }
      if (run !== runRef.current) return;
      if (creates.length > 0) res = resolveFacts(eff.facts, current, dimensionLabels);
      setDict(current);
      if (!res.rows) {
        setPhase({ kind: "values", resolution: res });
        return;
      }
      await stage(run, eff, res.rows);
    },
    [dimensionLabels, rememberValues, stage],
  );

  // (Re)start whenever the month choice changes or the user asks to try again.
  useEffect(() => {
    if (alreadyPublished) return;
    const run = ++runRef.current;
    void (async () => {
      try {
        await discardStaged();
        if (run !== runRef.current) return;
        setPhase({ kind: "preparing" });
        const eff = await excludeMonths(result, includeOpen ? [] : open);
        if (run !== runRef.current) return;
        setEffective(eff);
        if (eff.slices.length === 0 || (eff.facts.length === 0 && !eff.ledger?.rows.length)) {
          setPhase({ kind: "empty" });
          return;
        }
        if (eff.ledger) {
          await stage(run, eff, null);
          return;
        }
        const d = await getDictionaries(factDimensions(eff.facts));
        if (run !== runRef.current) return;
        await resolveAndStage(run, eff, d);
      } catch (error) {
        if (run === runRef.current) setPhase({ kind: "error", message: message(error) });
      }
    })();
    return invalidate;
  }, [
    result,
    includeOpen,
    open,
    restart,
    alreadyPublished,
    discardStaged,
    getDictionaries,
    resolveAndStage,
    stage,
    invalidate,
  ]);

  // A staged upload that was never published is discarded when the review closes.
  useEffect(
    () => () => {
      discardStaged().catch(() => undefined);
    },
    [discardStaged],
  );

  const afterValues = async (dimension: string, ids: Record<string, number>) => {
    if (!effective) return;
    const next = withResolvedValues(dict, dimension, ids);
    rememberValues(dimension, next[dimension]!);
    setDict(next);
    const res = resolveFacts(effective.facts, next, dimensionLabels);
    if (res.rows) await stage(runRef.current, effective, res.rows);
    else setPhase({ kind: "values", resolution: res });
  };

  /** Run a value decision; failures end in the error phase ("Granska igen" starts over). */
  const decide = async (
    work: () => Promise<{ dimension: string; ids: Record<string, number> } | string>,
  ) => {
    setBusy(true);
    try {
      const outcome = await work();
      setBusy(false);
      if (typeof outcome === "string") setPhase({ kind: "error", message: outcome });
      else await afterValues(outcome.dimension, outcome.ids);
    } catch (error) {
      setBusy(false);
      setPhase({ kind: "error", message: message(error) });
    }
  };

  const addNew = (dimension: string, labels: string[]) =>
    decide(async () => {
      const r = await ensureValuesAction({ dimension, labels, force: true });
      if (!r.ok) return r.error;
      const ids: Record<string, number> = {};
      for (const [label, id] of Object.entries(r.data)) if (id !== null) ids[label] = id;
      return { dimension, ids };
    });

  const sameAs = (dimension: string, label: string, valueId: number) =>
    decide(async () => {
      const r = await addAliasAction({ dimension, alias: label, valueId });
      return r.ok ? { dimension, ids: { [label]: valueId } } : r.error;
    });

  const publish = useCallback(async (): Promise<boolean> => {
    if (phase.kind !== "ready" || !effective) return false;
    const { comparison, uploadId } = phase;
    setPhase({ kind: "publishing", comparison, uploadId });
    let r: Awaited<ReturnType<typeof publishUploadAction>>;
    try {
      r = await publishUploadAction({ uploadId });
    } catch (error) {
      r = { ok: false, error: message(error) };
    }
    if (!r.ok) {
      setPhase({ kind: "ready", comparison, uploadId, error: r.error });
      return false;
    }
    uploadRef.current = null;
    const metricKeys = effective.ledger
      ? [...new Set(comparison.rows.map((x) => x.metricKey))]
      : resultMetricKeys(effective);
    const summary = publishSummaryText({
      metricCount: metricKeys.length,
      months: resultMonths(effective),
      companies: effective.companies,
      replacedPublishedAt: r.data.replacedPublishedAt,
      now,
    });
    setPhase({ kind: "published", summary });
    onPublished(item.id, summary, new Date().toISOString());
    return true;
  }, [phase, effective, now, onPublished, item.id]);

  useEffect(() => {
    register(item.id, phase.kind === "ready" ? publish : null);
  }, [register, item.id, phase.kind, publish]);
  useEffect(() => () => register(item.id, null), [register, item.id]);

  const cancel = async () => {
    invalidate();
    try {
      await discardStaged();
    } catch {
      // A staged upload that could not be discarded stays invisible; it is never published.
    }
    setPhase({ kind: "discarded" });
    onDiscarded?.();
  };

  const metrics = catalog.metrics;
  const reviewRows =
    phase.kind === "ready" || phase.kind === "publishing"
      ? buildReviewRows(
          phase.comparison.rows,
          metrics,
          effective && !effective.ledger
            ? {
                produced: [
                  ...resultMetricKeys(effective),
                  ...(templateConfig ? templateMetricKeys(templateConfig) : []),
                ],
              }
            : {},
        )
      : [];
  const shown = effective ?? result;
  const busyPhase = ["preparing", "staging", "comparing", "publishing"].includes(phase.kind);
  const templateName =
    item.template?.name ?? (item.format === "sie" ? "Fortnox – bokföring (SIE)" : "");

  return (
    <Panel className="flex flex-col gap-6" data-testid="review-panel" data-phase={phase.kind}>
      <div className="flex flex-col gap-1">
        <h3 className="truncate text-base font-medium" title={item.fileName}>
          {item.fileName}
          {item.sheetName ? (
            <span className="text-muted-foreground"> · {item.sheetName}</span>
          ) : null}
        </h3>
        <p className="text-sm text-muted-foreground">
          {[
            templateName,
            formatMonthSpan(resultMonths(shown)),
            shown.companies.map((c) => COMPANY_FILTER_LABELS[c]).join(" och "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {open.length > 0 && phase.kind !== "published" ? (
        <label className="flex items-start gap-3 rounded-lg bg-ljusgra-100 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-antracit"
            checked={includeOpen}
            disabled={busyPhase}
            onChange={(e) => setIncludeOpen(e.target.checked)}
            data-testid="include-open-months"
          />
          <span>
            Ta med {formatMonthSpan(open)} som inte är slut ännu.
            <span className="block text-muted-foreground">
              Siffrorna för en pågående månad är ofullständiga och lämnas därför utanför om du inte
              väljer annat.
            </span>
          </span>
        </label>
      ) : null}

      <div aria-live="polite" className="flex flex-col gap-4">
        {phase.kind === "preparing" ? (
          <p className="text-sm text-muted-foreground">Förbereder granskningen…</p>
        ) : null}
        {phase.kind === "values" ? (
          <UnknownValues
            groups={phase.resolution.unknown}
            dictionary={dict}
            busy={busy}
            onAddNew={(d, l) => void addNew(d, [l])}
            onAddAll={(d, ls) => void addNew(d, ls)}
            onSameAs={(d, l, id) => void sameAs(d, l, id)}
          />
        ) : null}
        {phase.kind === "staging" ? (
          <ProgressBar
            value={progressPercent(phase.done, phase.total)}
            label="Förbereder siffrorna"
          />
        ) : null}
        {phase.kind === "comparing" ? (
          <p className="text-sm text-muted-foreground">Jämför med publicerade siffror…</p>
        ) : null}
        {phase.kind === "ready" || phase.kind === "publishing" ? (
          <ComparisonTable rows={reviewRows} thresholdPct={phase.comparison.thresholdPct} />
        ) : null}
        {phase.kind === "ready" && phase.error ? (
          <p role="alert" className="text-sm">
            {phase.error}
          </p>
        ) : null}
        {phase.kind === "published" ? (
          <p className="text-base font-medium" data-testid="published-summary">
            {phase.summary}
          </p>
        ) : null}
        {phase.kind === "discarded" ? (
          <p className="text-sm">Avbrutet – ingenting publicerades.</p>
        ) : null}
        {phase.kind === "empty" ? (
          <p className="text-sm">
            {result.facts.length === 0 && !result.ledger?.rows.length
              ? "Filen gav inga siffror att publicera. Kontrollera mallen eller valen för filen."
              : "Det finns inga avslutade månader att publicera i filen."}
          </p>
        ) : null}
        {phase.kind === "error" ? (
          <p role="alert" className="text-sm">
            {phase.message}
          </p>
        ) : null}
      </div>

      {result.ledger ? <SieChecks result={result} /> : null}

      <details className="rounded-lg border border-border p-3">
        <summary className="num cursor-pointer text-sm font-medium">
          Detaljer om filen
          <span className="font-normal text-muted-foreground">
            {" "}
            · {formatNumber(shown.report.rowsRead)} rader lästes,{" "}
            {formatNumber(shown.report.rowsUsed)} användes
          </span>
        </summary>
        <div className="pt-3">
          <ReportDetails result={shown} dimensionLabel={(k) => dimensionLabels[k] ?? k} />
        </div>
      </details>

      {phase.kind !== "published" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="px-5"
            disabled={phase.kind !== "ready"}
            onClick={() => void publish()}
            data-testid="publish-button"
          >
            {phase.kind === "publishing" ? "Publicerar…" : "Godkänn och publicera"}
          </Button>
          {phase.kind === "discarded" || phase.kind === "error" ? (
            <Button
              size="lg"
              variant="outline"
              className="px-5"
              onClick={() => setRestart((n) => n + 1)}
              data-testid="retry-button"
            >
              Granska igen
            </Button>
          ) : (
            <Button
              size="lg"
              variant="outline"
              className="px-5"
              disabled={phase.kind === "publishing"}
              onClick={() => void cancel()}
              data-testid="discard-button"
            >
              Avbryt
            </Button>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
