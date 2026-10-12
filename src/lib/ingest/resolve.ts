// Dimension label -> dimension_values.id resolution before staging facts.
import type { FactDraft, FactRow } from "@/lib/contracts";
import { normalizeValue } from "@/lib/core/normalize";

export interface DimensionDictionary {
  /** normalizeValue(label or alias) -> dimension_values.id */
  byNorm: Record<string, number>;
  policy: "ask" | "auto_create";
}

export interface ResolveResult {
  /** All facts with ids, or null while any label is unknown. */
  rows: FactRow[] | null;
  /** dimension -> unknown labels (first-seen order), across all policies. */
  unknown: Record<string, string[]>;
  /** The unknown labels of auto_create dimensions (create them, then resolve again). */
  toCreate: Record<string, string[]>;
  /** The unknown labels the user must map (ask policy, or a dimension missing from the dictionary). */
  toAsk: Record<string, string[]>;
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Resolve every fact's dimension labels via normalizeValue(label). */
export function resolveDims(
  facts: FactDraft[],
  dict: Record<string, DimensionDictionary>,
): ResolveResult {
  const unknown = new Map<string, string[]>();
  const seen = new Set<string>();
  const rows: FactRow[] = [];

  for (const fact of facts) {
    const dims: Record<string, number> = {};
    let complete = true;
    for (const [dim, label] of Object.entries(fact.dims)) {
      const entry = hasOwn(dict, dim) ? dict[dim] : undefined;
      const norm = normalizeValue(label);
      const id = entry && hasOwn(entry.byNorm, norm) ? entry.byNorm[norm] : undefined;
      if (id !== undefined) {
        dims[dim] = id;
        continue;
      }
      complete = false;
      const key = `${dim}\u0000${norm}`;
      if (!seen.has(key)) {
        seen.add(key);
        const list = unknown.get(dim) ?? [];
        list.push(label);
        unknown.set(dim, list);
      }
    }
    if (complete) rows.push({ ...fact, dims });
  }

  const out: ResolveResult = {
    rows: unknown.size === 0 ? rows : null,
    unknown: {},
    toCreate: {},
    toAsk: {},
  };
  for (const [dim, labels] of unknown) {
    out.unknown[dim] = labels;
    const policy = hasOwn(dict, dim) ? dict[dim]?.policy : undefined;
    if (policy === "auto_create") out.toCreate[dim] = labels;
    else out.toAsk[dim] = labels;
  }
  return out;
}
