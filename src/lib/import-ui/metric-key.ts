// "Nytt mått…": a new sum or snapshot metric created from the mapping view.
import { z } from "zod";
import type { ColumnType, Unit } from "@/lib/contracts";

/** Units offered for a new metric, in plain words. */
export const NEW_METRIC_UNITS: { unit: Extract<Unit, "st" | "kr" | "h" | "pct">; label: string }[] =
  [
    { unit: "st", label: "Antal (st)" },
    { unit: "kr", label: "Kronor (kr)" },
    { unit: "h", label: "Timmar (h)" },
    { unit: "pct", label: "Procent (%)" },
  ];

export const NEW_METRIC_KINDS = [
  {
    kind: "sum" as const,
    label: "Summa",
    description: "Månaderna läggs ihop, till exempel timmar eller fakturerat belopp.",
  },
  {
    kind: "snapshot" as const,
    label: "Ögonblicksbild",
    description:
      "Ett läge vid månadens slut, till exempel antal anställda. Månaderna läggs aldrig ihop; för ett kvartal visas den sista månaden.",
  },
];

export const NewMetricSchema = z.object({
  datasetKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  name: z.string().trim().min(2, "Ge måttet ett namn.").max(80, "Namnet är för långt."),
  unit: z.enum(["st", "kr", "h", "pct"]),
  kind: z.enum(["sum", "snapshot"]),
  higherIsBetter: z.boolean().nullable(),
});
export type NewMetric = z.infer<typeof NewMetricSchema>;

/** The unit that fits a column type. */
export function unitForColumnType(type: ColumnType): NewMetric["unit"] {
  switch (type) {
    case "amount":
      return "kr";
    case "hours":
      return "h";
    case "percent":
      return "pct";
    default:
      return "st";
  }
}

const FOLD: Record<string, string> = { å: "a", ä: "a", ö: "o", é: "e", è: "e", ü: "u" };

/** A unique metric key from a Swedish name: "Sjuka pass (övertid)" -> "sjuka_pass_overtid". */
export function metricKeyFromName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  let base = name
    .normalize("NFC")
    .toLocaleLowerCase("sv")
    .replace(/[åäöéèü]/g, (c) => FOLD[c] ?? c)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  if (!/^[a-z]/.test(base)) base = `matt_${base}`.replace(/_+$/, "");
  if (base.length < 2) base = "matt";
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

/** Definite-form subject for headlines; the name in capitals is a safe default. */
export function headlineSubjectFor(name: string): string {
  return name.trim().toLocaleUpperCase("sv");
}
