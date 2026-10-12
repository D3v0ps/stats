// Edit distance and a normalized similarity, used to spot renamed columns
// ("Anställnings-id" vs "Anställningsid") when a template drifts.

/** Levenshtein distance over Unicode code points. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const s = Array.from(a);
  const t = Array.from(b);
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  let curr = new Array<number>(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[t.length]!;
}

/** 1 = identical, 0 = nothing in common. Two empty strings are identical. */
export function similarity(a: string, b: string): number {
  const len = Math.max(Array.from(a).length, Array.from(b).length);
  if (len === 0) return 1;
  return 1 - levenshtein(a, b) / len;
}
