// Recognition: which saved templates fit a dropped workbook. A template with a
// sheet hint is tried on that sheet, others on the default sheet. Every sheet
// with a compatible template becomes a job that runs by itself; a sheet that
// resembles a template (or has a template of its own) but changed becomes "the
// file has changed"; a file that resembles nothing becomes a new report type to
// map. Other visible sheets laid out like a sheet that is handled (the second
// company's budget sheet) become new report types too, so no sheet is skipped
// without the user seeing it. A template whose header row was picked by hand is
// matched against the sheet read at that row.
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
  /** 0-based header row saved with the template (picked by hand). */
  headerRow?: number;
}

/**
 * What happens with a sheet. `signature` is set when the template was matched on
 * its own header row: the sheet's signature at that row.
 */
export type Job =
  | {
      kind: "known";
      sheetName: string;
      template: RecognitionTemplate;
      score: number;
      signature?: string[];
    }
  | {
      kind: "drift";
      sheetName: string;
      template: RecognitionTemplate;
      score: number;
      diff: SignatureDiff;
      signature?: string[];
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
  config: { kind: "table" | "cases" | "sie"; headerRow?: number };
}

export function toRecognitionTemplate(t: TemplateLike): RecognitionTemplate {
  const headerRow = t.config.kind === "sie" ? undefined : t.config.headerRow;
  return {
    id: t.id,
    name: t.name,
    datasetKey: t.datasetKey,
    kind: t.config.kind,
    version: t.version,
    headerSignature: t.headerSignature,
    ...(t.sheetHint ? { sheetHint: t.sheetHint } : {}),
    ...(t.updatedAt ? { updatedAt: t.updatedAt } : {}),
    ...(headerRow !== undefined ? { headerRow } : {}),
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
  /** sheet name -> header row -> signature read at that row (see templateHeaderRows). */
  signaturesAt?: Record<string, Record<number, string[]>>;
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

/** Header rows to read the sheets at before recognition (templates with a hand-picked row). */
export function templateHeaderRows(
  templates: readonly RecognitionTemplate[],
): { sheetHint?: string; row: number }[] {
  const seen = new Set<string>();
  const out: { sheetHint?: string; row: number }[] = [];
  for (const t of templates) {
    if (t.kind === "sie" || t.headerRow === undefined) continue;
    const key = `${t.sheetHint ?? ""}\u0000${t.headerRow}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...(t.sheetHint ? { sheetHint: t.sheetHint } : {}), row: t.headerRow });
  }
  return out;
}

/** The signature a template is matched with: the sheet read at the template's own header row. */
function signatureFor(
  t: RecognitionTemplate,
  sheet: string,
  input: RecognitionInput,
): { signature: string[]; atRow: boolean } {
  const at = t.headerRow === undefined ? undefined : input.signaturesAt?.[sheet]?.[t.headerRow];
  return at
    ? { signature: at, atRow: true }
    : { signature: input.signatures[sheet]!, atRow: false };
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
    const matches = candidates.flatMap((t) => {
      const s = signatureFor(t, sheet, input);
      return matchTemplates(s.signature, [t]).map((m) => ({ m, t, s }));
    });
    // A sheet that has its own templates (by hint) prefers them over generic ones.
    const ranked = matches.sort(
      (a, b) =>
        Number(b.m.diff.compatible) - Number(a.m.diff.compatible) ||
        Number(ownSheet(b.t, input) === sheet) - Number(ownSheet(a.t, input) === sheet) ||
        Number(Boolean(b.t.sheetHint)) - Number(Boolean(a.t.sheetHint)) ||
        b.m.score - a.m.score ||
        (b.t.updatedAt ?? "").localeCompare(a.t.updatedAt ?? "") ||
        (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0),
    );
    const best = ranked[0];
    if (!best) continue;
    const signature = best.s.atRow ? { signature: best.s.signature } : {};
    if (best.m.diff.compatible) {
      jobs.push({
        kind: "known",
        sheetName: sheet,
        template: best.t,
        score: best.m.score,
        ...signature,
      });
    } else if (best.m.score >= DRIFT_MIN_SCORE || ownSheet(best.t, input) === sheet) {
      // A sheet's own template is shown as changed however much the sheet changed.
      jobs.push({
        kind: "drift",
        sheetName: sheet,
        template: best.t,
        score: best.m.score,
        diff: best.m.diff,
        ...signature,
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
