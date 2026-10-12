// Recognition: which saved templates fit a dropped workbook. A template with a
// sheet hint is tried on that sheet, others on the default sheet. Every sheet
// with a compatible template becomes a job that runs by itself; a sheet that
// resembles a template (or has a template of its own) but changed becomes "the
// file has changed"; a file that resembles nothing becomes a new report type to
// map. Other visible sheets laid out like a sheet that is handled (the second
// company's budget sheet) become new report types too, so no sheet is skipped
// without the user seeing it.
import type { SignatureDiff } from "@/lib/contracts";
import { normalizeHeader } from "@/lib/core/normalize";
import { diffSignature, matchTemplates } from "@/lib/ingest/recognize";

export interface RecognitionTemplate {
  id: string;
  name: string;
  datasetKey: string;
  kind: "table" | "cases" | "sie";
  version: number;
  headerSignature: string[];
  sheetHint?: string;
  updatedAt?: string;
}

export type Job =
  | { kind: "known"; sheetName: string; template: RecognitionTemplate; score: number }
  | {
      kind: "drift";
      sheetName: string;
      template: RecognitionTemplate;
      score: number;
      diff: SignatureDiff;
    }
  | { kind: "new"; sheetName: string };

/** A saved template as the repo returns it (StoredTemplate fits). */
export interface TemplateLike {
  id: string;
  name: string;
  datasetKey: string;
  version: number;
  headerSignature: string[];
  sheetHint?: string;
  updatedAt?: string;
  config: { kind: "table" | "cases" | "sie" };
}

export function toRecognitionTemplate(t: TemplateLike): RecognitionTemplate {
  return {
    id: t.id,
    name: t.name,
    datasetKey: t.datasetKey,
    kind: t.config.kind,
    version: t.version,
    headerSignature: t.headerSignature,
    ...(t.sheetHint ? { sheetHint: t.sheetHint } : {}),
    ...(t.updatedAt ? { updatedAt: t.updatedAt } : {}),
  };
}

/** Below this header overlap a file is a new report type, not a changed one. */
export const DRIFT_MIN_SCORE = 0.5;

export interface RecognitionInput {
  defaultSheet: string;
  /** sheet hint -> sheet chosen for it (from the worker's pickSheet). */
  sheetForHint: Record<string, string>;
  /** sheet name -> normalized header signature. */
  signatures: Record<string, string[]>;
  /** Sheet order of the workbook, for a stable job order. */
  sheetOrder?: string[];
  templates: readonly RecognitionTemplate[];
}

/** Sheet hints to resolve before recognition. */
export function templateHints(templates: readonly RecognitionTemplate[]): string[] {
  return [
    ...new Set(templates.flatMap((t) => (t.kind !== "sie" && t.sheetHint ? [t.sheetHint] : []))),
  ];
}

function sheetOf(t: RecognitionTemplate, input: RecognitionInput): string {
  return (t.sheetHint && input.sheetForHint[t.sheetHint]) || input.defaultSheet;
}

/**
 * The sheet a template's hint really names. pickSheet falls back to the default
 * sheet when no sheet has the hinted name; such a fallback is not the template's
 * own sheet.
 */
function ownSheet(t: RecognitionTemplate, input: RecognitionInput): string | null {
  if (t.kind === "sie" || !t.sheetHint) return null;
  const sheet = input.sheetForHint[t.sheetHint];
  if (sheet === undefined) return null;
  if (sheet !== input.defaultSheet) return sheet;
  return normalizeHeader(sheet) === normalizeHeader(t.sheetHint) ? sheet : null;
}

/** Decide what happens with a workbook (see the module comment). */
export function planJobs(input: RecognitionInput): Job[] {
  const tableTemplates = input.templates.filter((t) => t.kind !== "sie");
  const bySheet = new Map<string, RecognitionTemplate[]>();
  for (const t of tableTemplates) {
    const sheet = sheetOf(t, input);
    if (!input.signatures[sheet]) continue;
    bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), t]);
  }

  const jobs: Job[] = [];
  for (const [sheet, candidates] of bySheet) {
    const matches = matchTemplates(input.signatures[sheet]!, candidates);
    const byId = new Map(candidates.map((t) => [t.id, t]));
    // A sheet that has its own templates (by hint) prefers them over generic ones.
    const ranked = matches
      .map((m) => ({ m, t: byId.get(m.id)! }))
      .sort(
        (a, b) =>
          Number(b.m.diff.compatible) - Number(a.m.diff.compatible) ||
          Number(ownSheet(b.t, input) === sheet) - Number(ownSheet(a.t, input) === sheet) ||
          Number(Boolean(b.t.sheetHint)) - Number(Boolean(a.t.sheetHint)) ||
          b.m.score - a.m.score ||
          (b.t.updatedAt ?? "").localeCompare(a.t.updatedAt ?? ""),
      );
    const best = ranked[0];
    if (!best) continue;
    if (best.m.diff.compatible) {
      jobs.push({ kind: "known", sheetName: sheet, template: best.t, score: best.m.score });
    } else if (best.m.score >= DRIFT_MIN_SCORE || ownSheet(best.t, input) === sheet) {
      // A sheet's own template is shown as changed however much the sheet changed.
      jobs.push({
        kind: "drift",
        sheetName: sheet,
        template: best.t,
        score: best.m.score,
        diff: best.m.diff,
      });
    }
  }
  if (jobs.length === 0) jobs.push({ kind: "new", sheetName: input.defaultSheet });

  // A sheet with a template of its own is never skipped, even when nothing matches any more.
  for (const t of tableTemplates) {
    const own = ownSheet(t, input);
    if (own && input.signatures[own] && !jobs.some((j) => j.sheetName === own)) {
      jobs.push({ kind: "new", sheetName: own });
    }
  }

  // Sibling sheets: same layout as a handled sheet, but no template of their own.
  const covered = new Set(jobs.map((j) => j.sheetName));
  const order = input.sheetOrder ?? [];
  for (const sheet of order.length > 0 ? order : Object.keys(input.signatures)) {
    const sig = input.signatures[sheet];
    if (covered.has(sheet) || !sig || sig.length === 0) continue;
    const sameLayout = jobs.some((j) => {
      const handled = input.signatures[j.sheetName];
      return handled !== undefined && diffSignature(handled, sig).compatible;
    });
    if (!sameLayout) continue;
    jobs.push({ kind: "new", sheetName: sheet });
    covered.add(sheet);
  }

  return order.length > 0
    ? jobs.sort((a, b) => order.indexOf(a.sheetName) - order.indexOf(b.sheetName))
    : jobs;
}

export interface DriftChange {
  kind: "added" | "removed" | "renamed";
  label: string;
  from?: string;
  to?: string;
  column?: string;
}

/** "Ny kolumn", "Saknad kolumn", "Omdöpt kolumn: från → till", in that order. */
export function driftChanges(diff: SignatureDiff): DriftChange[] {
  return [
    ...diff.added.map((column) => ({ kind: "added" as const, label: "Ny kolumn", column })),
    ...diff.removed.map((column) => ({ kind: "removed" as const, label: "Saknad kolumn", column })),
    ...diff.renamed.map((r) => ({
      kind: "renamed" as const,
      label: "Omdöpt kolumn",
      from: r.from,
      to: r.to,
    })),
  ];
}
