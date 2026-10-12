// "Uppdatera mallen": carry a template over to a file whose columns changed.
// Renamed columns get a rename back to the old name at the very start, so the
// rest of the mapping keeps working untouched; steps and mappings that need a
// column the file no longer has are taken out (and listed for the user).
import type {
  CasesTemplateConfig,
  ColumnMapping,
  SignatureDiff,
  Step,
  TableTemplateConfig,
} from "@/lib/contracts";
import type { FieldMapping, MappingState } from "./mapping";
import { simulateColumns } from "./mapping";

export interface MigratedConfig<C extends TableTemplateConfig | CasesTemplateConfig> {
  config: C;
  /** Steps that needed a column the new file lacks. */
  removedSteps: Step[];
  /** Columns of the template the new file lacks (not renamed). */
  missingColumns: string[];
  /** Renames proposed from the diff (new name in the file -> name in the template). */
  renames: { from: string; to: string }[];
}

/** Repeatedly drop steps that the column flow cannot run (dropping one can break the next). */
function runnableSteps(
  columns: readonly string[],
  steps: Step[],
): { kept: Step[]; removed: Step[] } {
  let kept = [...steps];
  const removed: Step[] = [];
  for (;;) {
    const broken = simulateColumns(columns, kept).broken;
    if (broken.length === 0) return { kept, removed };
    const first = broken[0]!;
    removed.push(kept[first.index]!);
    kept = kept.filter((_, i) => i !== first.index);
  }
}

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const coversWords = (big: string, small: string) => {
  const b = words(big);
  const w = words(small);
  return w.length > 0 && w.every((x) => b.includes(x));
};

export interface ProposedRename {
  /** Column name in the template. */
  from: string;
  /** Column name in the new file. */
  to: string;
  /** false when only the word heuristic suggests it ("antal timmar" for "timmar"). */
  certain: boolean;
}

/**
 * Renames to propose for a changed file: the diff's renames, plus a missing
 * column whose words all appear in exactly one new column (or the other way
 * round), e.g. "timmar" -> "antal timmar", which is too different for the
 * signature diff's similarity threshold.
 */
export function proposeRenames(diff: SignatureDiff): ProposedRename[] {
  const out: ProposedRename[] = diff.renamed.map((r) => ({
    from: r.from,
    to: r.to,
    certain: true,
  }));
  const usedTo = new Set(out.map((r) => r.to));
  for (const from of diff.removed) {
    const candidates = diff.added.filter(
      (to) => !usedTo.has(to) && (coversWords(to, from) || coversWords(from, to)),
    );
    if (candidates.length !== 1) continue;
    const to = candidates[0]!;
    const rivals = diff.removed.filter(
      (r) => r !== from && (coversWords(to, r) || coversWords(r, to)),
    );
    if (rivals.length > 0) continue;
    out.push({ from, to, certain: false });
    usedTo.add(to);
  }
  return out;
}

export function migrateConfig<C extends TableTemplateConfig | CasesTemplateConfig>(
  config: C,
  diff: SignatureDiff,
  fileColumns: readonly string[],
): MigratedConfig<C> {
  const renames = proposeRenames(diff)
    .filter((r) => fileColumns.includes(r.to) && !fileColumns.includes(r.from))
    .map((r) => ({ from: r.to, to: r.from }));
  const head: Step[] = renames.map((r) => ({ op: "rename", column: r.from, to: r.to }));
  const { kept, removed } = runnableSteps(fileColumns, [...head, ...(config.steps ?? [])]);
  const output = simulateColumns(fileColumns, kept).columns;
  const renamedFrom = new Set(renames.map((r) => r.to));
  const missingColumns = diff.removed.filter(
    (c) => !fileColumns.includes(c) && !renamedFrom.has(c),
  );

  const columns: ColumnMapping[] = config.columns.filter(
    (m) => output.includes(m.column) || (m.keep === false && fileColumns.includes(m.column)),
  );
  const next = { ...config, steps: kept, columns } as C;
  if (next.kind === "cases") {
    const c = { ...next.cases };
    const has = (col: string | undefined) => col !== undefined && output.includes(col);
    if (!has(c.keyColumn)) delete c.keyColumn;
    if (!has(c.endColumn)) delete c.endColumn;
    if (!has(c.interruptColumn)) delete c.interruptColumn;
    if (!has(c.interruptDateColumn)) delete c.interruptDateColumn;
    if (!has(c.resultColumn)) delete c.resultColumn;
    if (!has(c.resultDateColumn)) delete c.resultDateColumn;
    c.groupBy = (c.groupBy ?? []).filter((g) => output.includes(g));
    (next as CasesTemplateConfig).cases = c;
  } else {
    const t = next as TableTemplateConfig;
    if (t.period.kind === "column" && !output.includes(t.period.column))
      t.period = { kind: "per_upload" };
    if (t.company.kind === "column" && !output.includes(t.company.column))
      t.company = { kind: "per_upload" };
  }
  if (next.company.kind === "column" && !output.includes(next.company.column)) {
    next.company = { kind: "per_upload" };
  }
  return {
    config: next,
    removedSteps: removed.filter((s) => !head.includes(s)),
    missingColumns,
    renames,
  };
}

/**
 * New columns of the file get the first-guess mapping; new personal columns
 * start removed, like in a fresh mapping.
 */
export function fillNewColumns(
  state: MappingState,
  suggestions: readonly ColumnMapping[],
  newColumns: readonly string[],
): MappingState {
  const fields: Record<string, FieldMapping> = { ...state.fields };
  const sources = state.sources.map((s) => {
    if (!newColumns.includes(s.name)) return s;
    const sug = suggestions.find((m) => m.column === s.name);
    if (!sug) return s;
    if (!(s.rename in fields)) {
      fields[s.rename] = {
        type: sug.type,
        usage: sug.usage,
        ...(sug.metricKey ? { metricKey: sug.metricKey } : {}),
        ...(sug.dimensionKey ? { dimensionKey: sug.dimensionKey } : {}),
      };
    }
    const personal = s.personal || sug.personal;
    return { ...s, personal, keep: s.keep && !personal && sug.keep !== false };
  });
  return { ...state, sources, fields };
}
