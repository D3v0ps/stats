// Freezing a report: the dialog's defaults (title "Styrelsemöte v.42", month) and the
// validated input of the freeze server action. The numbers themselves are always
// re-resolved on the server; the client only says which template, month and title.
import { z } from "zod";
import { MonthSchema } from "@/lib/contracts/domain";
import { addMonths, type Month } from "@/lib/core/month";
import { monthTitle } from "./labels";

const STOCKHOLM = "Europe/Stockholm";

export const FREEZE_TITLE_MAX = 120;

/** ISO 8601 week (Monday start, week 1 holds the year's first Thursday) of a calendar date. */
export function isoWeekOfDate(
  year: number,
  month: number,
  day: number,
): { year: number; week: number } {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  // The Thursday of this week decides the ISO year.
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year: isoYear, week };
}

/** ISO week of an instant as seen in Stockholm (the board meets in Swedish time). */
export function isoWeek(now: Date, timeZone: string = STOCKHOLM): { year: number; week: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return isoWeekOfDate(get("year"), get("month"), get("day"));
}

/** "Styrelsemöte v.42" for the week of `now`. */
export function defaultFreezeTitle(now: Date): string {
  return `Styrelsemöte v.${isoWeek(now).week}`;
}

export interface MonthOption {
  value: Month;
  label: string;
}

/** The `count` months ending at `latest`, newest first ("September 2026"). */
export function monthOptions(latest: Month, count = 24): MonthOption[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const value = addMonths(latest, -i);
    return { value, label: monthTitle(value) };
  });
}

/** Options that always contain `selected` (a deck can show an older month than the list). */
export function monthOptionsWith(latest: Month, selected: Month, count = 24): MonthOption[] {
  const options = monthOptions(latest, count);
  if (options.some((o) => o.value === selected)) return options;
  return [...options, { value: selected, label: monthTitle(selected) }].sort((a, b) =>
    b.value.localeCompare(a.value),
  );
}

export const FreezeInputSchema = z.object({
  templateId: z.guid("Okänd rapportmall"),
  title: z
    .string()
    .trim()
    .min(1, "Rapporten behöver en titel")
    .max(FREEZE_TITLE_MAX, `Titeln får vara högst ${FREEZE_TITLE_MAX} tecken`),
  month: MonthSchema,
});
export type FreezeInput = z.infer<typeof FreezeInputSchema>;

/** First validation message in Swedish, for the dialog. */
export function freezeInputError(input: unknown): string | null {
  const parsed = FreezeInputSchema.safeParse(input);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (issue?.path[0] === "month") return "Välj en månad";
  return issue?.message ?? "Ogiltiga uppgifter";
}
