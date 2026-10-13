// The upload queue: one card per file (or per sheet when a workbook holds
// several known reports) moving through Läser… -> känd/ny/ändrad -> Klar att
// granska -> Publicerad. A pure reducer with explicit transitions; the page
// component performs the side effects (worker calls, server actions) and
// dispatches what happened.
import type {
  FileFormat,
  IngestResult,
  SignatureDiff,
  TemplateConfig,
  UploadChoices,
} from "@/lib/contracts";
import { formatDateSv } from "@/lib/core/format-sv";
import type { CompanySuggestion, PeriodSuggestion } from "@/lib/ingest/recognize";

export type ItemStatus =
  | "reading"
  | "running"
  | "needs_choices"
  | "new"
  | "drift"
  | "ready"
  | "published"
  | "duplicate"
  | "unsupported"
  | "error";

export interface TemplateRef {
  id: string;
  name: string;
  version: number;
  datasetKey: string;
  kind: TemplateConfig["kind"];
}

export interface ChoiceRequirements {
  month: boolean;
  company: boolean;
  asOfDate: boolean;
}

export interface Suggestions {
  period: PeriodSuggestion[];
  company: CompanySuggestion | null;
  asOfDate?: string;
}

export interface QueueItem {
  id: string;
  /** Key of the file in the ingest service (shared by sheets of one workbook). */
  fileId: string;
  fileName: string;
  fileSize: number;
  /** Set for every job of a workbook with several known sheets. */
  sheetName?: string;
  /** The sheet the job reads (also when there is only one). */
  sourceSheet?: string;
  /** Normalized headers of that sheet (to recognize it again after a template is saved). */
  signature?: string[];
  /** 0-based header row chosen by hand in the mapping view. */
  headerRow?: number;
  status: ItemStatus;
  sha256?: string;
  format?: FileFormat;
  template?: TemplateRef;
  drift?: SignatureDiff;
  suggestions: Suggestions;
  choices: UploadChoices;
  requires: ChoiceRequirements;
  result?: IngestResult;
  message?: string;
  publishedAt?: string;
  summary?: string;
}

interface JobBase {
  sheetName: string;
  signature: string[];
  suggestions: Suggestions;
}

export type JobOutcome =
  | (JobBase & { kind: "known"; template: TemplateRef; requires: ChoiceRequirements })
  | (JobBase & { kind: "drift"; template: TemplateRef; diff: SignatureDiff })
  | (JobBase & { kind: "new" });

export type QueueAction =
  | { type: "add"; items: QueueItem[] }
  | { type: "read"; id: string; sha256: string; format: FileFormat }
  | { type: "recognized"; id: string; jobs: JobOutcome[] }
  | { type: "sie_ready"; id: string; result: IngestResult }
  | { type: "duplicate"; id: string; publishedAt: string }
  | { type: "set_choices"; id: string; choices: UploadChoices }
  /** A changed file that is really another report: it is mapped as a new report type. */
  | { type: "map_as_new"; id: string }
  | {
      type: "template_saved";
      id: string;
      template: TemplateRef;
      requires: ChoiceRequirements;
      /** The mapping view's header row; omitted = detected (replaces an earlier choice). */
      headerRow?: number;
    }
  | { type: "run_done"; id: string; result: IngestResult }
  | { type: "failed"; id: string; message: string }
  | { type: "unsupported"; id: string; message: string }
  | { type: "published"; id: string; summary: string; publishedAt: string }
  | { type: "remove"; id: string };

export const NO_CHOICES: ChoiceRequirements = { month: false, company: false, asOfDate: false };

/** What the user must confirm per upload for a template. */
export function requiredChoices(config: TemplateConfig): ChoiceRequirements {
  if (config.kind === "sie") return NO_CHOICES;
  return {
    month: config.kind === "table" && config.period.kind === "per_upload",
    company: config.company.kind === "per_upload",
    asOfDate: config.kind === "cases",
  };
}

/** Suggestions strong enough to pre-fill the chips (the user can always change them). */
export function autoChoices(requires: ChoiceRequirements, s: Suggestions): UploadChoices {
  const out: UploadChoices = {};
  const month = s.period[0];
  if (requires.month && month && month.confidence >= 0.5) out.month = month.month;
  if (requires.company && s.company && s.company.confidence >= 0.6) out.company = s.company.company;
  if (requires.asOfDate && s.asOfDate) out.asOfDate = s.asOfDate;
  return out;
}

export function missingChoices(
  item: Pick<QueueItem, "requires" | "choices">,
): (keyof ChoiceRequirements)[] {
  const out: (keyof ChoiceRequirements)[] = [];
  if (item.requires.month && !item.choices.month) out.push("month");
  if (item.requires.company && !item.choices.company) out.push("company");
  if (item.requires.asOfDate && !item.choices.asOfDate) out.push("asOfDate");
  return out;
}

const CHOICE_WORDS: Record<keyof ChoiceRequirements, string> = {
  month: "månad",
  company: "bolag",
  asOfDate: "exportdatum",
};

/** "Välj månad och bolag" */
export function missingChoicesText(item: Pick<QueueItem, "requires" | "choices">): string | null {
  const words = missingChoices(item).map((k) => CHOICE_WORDS[k]);
  if (words.length === 0) return null;
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")} och ${words[words.length - 1]}`;
  return `Välj ${list}`;
}

function update(
  state: QueueItem[],
  id: string,
  fn: (item: QueueItem) => QueueItem | null,
): QueueItem[] {
  let changed = false;
  const out: QueueItem[] = [];
  for (const item of state) {
    if (item.id !== id) {
      out.push(item);
      continue;
    }
    const next = fn(item);
    if (next !== item) changed = true;
    if (next) out.push(next);
  }
  return changed ? out : state;
}

const ACTIVE: ItemStatus[] = ["reading", "running"];

export function queueReducer(state: QueueItem[], action: QueueAction): QueueItem[] {
  switch (action.type) {
    case "add": {
      const ids = new Set(state.map((i) => i.id));
      const fresh = action.items.filter((i) => !ids.has(i.id));
      return fresh.length ? [...state, ...fresh] : state;
    }
    case "read":
      return update(state, action.id, (item) =>
        item.status === "reading"
          ? { ...item, sha256: action.sha256, format: action.format }
          : item,
      );
    case "recognized": {
      const index = state.findIndex((i) => i.id === action.id);
      const item = state[index];
      if (!item || item.status !== "reading" || action.jobs.length === 0) return state;
      const several = action.jobs.length > 1;
      const items = action.jobs.map((job, k): QueueItem => {
        const base: QueueItem = {
          ...item,
          id: k === 0 ? item.id : `${item.id}:${k}`,
          sourceSheet: job.sheetName,
          signature: job.signature,
          ...(several ? { sheetName: job.sheetName } : {}),
          suggestions: job.suggestions,
        };
        if (job.kind === "known") {
          const choices = autoChoices(job.requires, job.suggestions);
          const next = { ...base, template: job.template, requires: job.requires, choices };
          return { ...next, status: missingChoices(next).length ? "needs_choices" : "running" };
        }
        if (job.kind === "drift")
          return { ...base, template: job.template, drift: job.diff, status: "drift" };
        return { ...base, status: "new" };
      });
      return [...state.slice(0, index), ...items, ...state.slice(index + 1)];
    }
    case "sie_ready":
      return update(state, action.id, (item) =>
        item.status === "reading"
          ? action.result.companies.length === 0
            ? {
                ...item,
                status: "error",
                result: action.result,
                message:
                  "Bolaget kunde inte avgöras från organisationsnumret. Filen kan inte publiceras.",
              }
            : {
                ...item,
                status: "ready",
                result: action.result,
                choices: { company: action.result.companies[0] },
              }
          : item,
      );
    case "duplicate":
      return update(state, action.id, (item) =>
        item.status === "published"
          ? item
          : {
              ...item,
              status: "duplicate",
              publishedAt: action.publishedAt,
              message: duplicateMessage(action.publishedAt),
            },
      );
    case "set_choices":
      return update(state, action.id, (item) => {
        const choices = { ...item.choices, ...action.choices };
        if (
          !["needs_choices", "ready", "error", "running"].includes(item.status) ||
          !item.template
        ) {
          return { ...item, choices };
        }
        if (item.template.kind === "sie") return { ...item, choices };
        const next = { ...item, choices, message: undefined };
        return {
          ...next,
          status: missingChoices(next).length ? "needs_choices" : "running",
          result: undefined,
        };
      });
    case "map_as_new":
      return update(state, action.id, (item) => {
        if (item.status !== "drift") return item;
        // The template it resembled stays as it is; the card now waits for a mapping of its own.
        const next: QueueItem = { ...item, status: "new" };
        delete next.template;
        delete next.drift;
        return next;
      });
    case "template_saved":
      return update(state, action.id, (item) => {
        const next: QueueItem = {
          ...item,
          template: action.template,
          requires: action.requires,
          drift: undefined,
          message: undefined,
          result: undefined,
          ...(action.headerRow !== undefined ? { headerRow: action.headerRow } : {}),
          choices: { ...autoChoices(action.requires, item.suggestions), ...item.choices },
        };
        if (action.headerRow === undefined) delete next.headerRow;
        return { ...next, status: missingChoices(next).length ? "needs_choices" : "running" };
      });
    case "run_done":
      return update(state, action.id, (item) =>
        item.status === "running"
          ? { ...item, status: "ready", result: action.result, message: undefined }
          : item,
      );
    case "failed":
      return update(state, action.id, (item) =>
        item.status === "published" ? item : { ...item, status: "error", message: action.message },
      );
    case "unsupported":
      return update(state, action.id, (item) => ({
        ...item,
        status: "unsupported",
        message: action.message,
      }));
    case "published":
      return update(state, action.id, (item) =>
        item.status === "ready"
          ? {
              ...item,
              status: "published",
              summary: action.summary,
              publishedAt: action.publishedAt,
            }
          : item,
      );
    case "remove":
      return update(state, action.id, (item) => (ACTIVE.includes(item.status) ? item : null));
  }
}

export function duplicateMessage(publishedAt: string): string {
  return `Den här filen är redan uppladdad (publicerad ${formatDateSv(publishedAt)}).`;
}

export function statusLabel(item: Pick<QueueItem, "status" | "template">): string {
  switch (item.status) {
    case "reading":
      return "Läser…";
    case "running":
    case "needs_choices":
      return `Känd rapport: ${item.template?.name ?? ""}`;
    case "new":
      return "Ny rapporttyp – mappa";
    case "drift":
      return "Filen har ändrats – se skillnaden";
    case "ready":
      return "Klar att granska";
    case "published":
      return "Publicerad";
    case "duplicate":
      return "Redan uppladdad";
    case "unsupported":
      return "Stöds inte";
    case "error":
      return "Fel";
  }
}

export type StatusTone = "busy" | "attention" | "ready" | "done" | "muted" | "error";

export function statusTone(status: ItemStatus): StatusTone {
  switch (status) {
    case "reading":
    case "running":
      return "busy";
    case "needs_choices":
    case "new":
    case "drift":
      return "attention";
    case "ready":
      return "ready";
    case "published":
      return "done";
    case "duplicate":
    case "unsupported":
      return "muted";
    case "error":
      return "error";
  }
}

export interface QueueCounts {
  total: number;
  busy: number;
  needsAction: number;
  ready: number;
  published: number;
}

export function queueCounts(items: readonly QueueItem[]): QueueCounts {
  const tone = (t: StatusTone) => items.filter((i) => statusTone(i.status) === t).length;
  return {
    total: items.length,
    busy: tone("busy"),
    needsAction: tone("attention") + tone("error"),
    ready: tone("ready"),
    published: tone("done"),
  };
}

/** True while leaving the page would lose work (files being read or waiting for review). */
export function hasUnfinishedWork(items: readonly QueueItem[]): boolean {
  return items.some((i) =>
    ["reading", "running", "needs_choices", "new", "drift", "ready"].includes(i.status),
  );
}

export function templateRef(t: {
  id: string;
  name: string;
  version: number;
  datasetKey: string;
  config: { kind: TemplateConfig["kind"] };
}): TemplateRef {
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    datasetKey: t.datasetKey,
    kind: t.config.kind,
  };
}

/** Identity of a run: a result belongs to the template version and choices it was made with. */
export function runToken(item: Pick<QueueItem, "template" | "choices" | "headerRow">): string {
  return JSON.stringify([
    item.template?.id ?? null,
    item.template?.version ?? null,
    item.choices.month ?? null,
    item.choices.company ?? null,
    item.choices.asOfDate ?? null,
    item.headerRow ?? null,
  ]);
}

export function newQueueItem(id: string, file: { name: string; size: number }): QueueItem {
  return {
    id,
    fileId: id,
    fileName: file.name,
    fileSize: file.size,
    status: "reading",
    suggestions: { period: [], company: null },
    choices: {},
    requires: NO_CHOICES,
  };
}
