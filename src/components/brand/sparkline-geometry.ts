// Geometry for <Sparkline>: SVG path segments with real gaps for missing months.

export interface Point {
  x: number;
  y: number;
  /** Index into the input values. */
  index: number;
}

export interface SparklineGeometry {
  /** One "M … L …" path per run of consecutive values. */
  segments: string[];
  /** Values with a missing neighbour on both sides: drawn as dots, a path would be invisible. */
  isolated: Point[];
  /** The last value that exists (marked in red). */
  last: Point | null;
}

export interface SparklineBox {
  width: number;
  height: number;
  /** Inner margin so strokes and the end dot are not clipped. */
  padding: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function sparklineGeometry(
  values: readonly (number | null | undefined)[],
  { width, height, padding }: SparklineBox,
): SparklineGeometry {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return { segments: [], isolated: [], last: null };

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  const x = (i: number) => round(values.length > 1 ? padding + i * step : width / 2);
  // A flat series sits in the middle instead of on the floor.
  const y = (v: number) =>
    round(max === min ? height / 2 : padding + (1 - (v - min) / (max - min)) * innerH);

  const runs: Point[][] = [];
  let run: Point[] = [];
  values.forEach((v, index) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      run.push({ x: x(index), y: y(v), index });
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);

  const segments: string[] = [];
  const isolated: Point[] = [];
  for (const r of runs) {
    if (r.length === 1) isolated.push(r[0]!);
    else segments.push(r.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" "));
  }
  const lastRun = runs.at(-1);
  return { segments, isolated, last: lastRun?.at(-1) ?? null };
}
