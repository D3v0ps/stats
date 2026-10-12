"use client";

// Editable chips for what a file covers: month, company and export date. They
// start from the suggestions (file name, report heading, data) and per-upload
// templates require them before the file can be read.
import { CalendarDays, Building2, CalendarCheck } from "lucide-react";
import { useId, useMemo, type ReactNode } from "react";
import { COMPANY_FILTER_LABELS, type CompanyCode, type UploadChoices } from "@/lib/contracts";
import { monthOptions } from "@/lib/import-ui/months";
import type { QueueItem } from "@/lib/import-ui/queue";
import { cn } from "@/lib/utils";

const COMPANY_OPTIONS: CompanyCode[] = ["MBAB", "MBR"];

function Chip({
  icon,
  label,
  missing,
  children,
}: {
  icon: ReactNode;
  label: string;
  missing: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-3 text-sm",
        missing ? "border-rod ring-1 ring-rod-200" : "border-ljusgra",
      )}
    >
      <span aria-hidden="true" className="text-antracit-300 [&_svg]:size-4">
        {icon}
      </span>
      <label htmlFor={id} className="text-xs tracking-[0.06em] text-antracit-300 uppercase">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

const chipControl =
  "h-7 rounded-full border-0 bg-ljusgra-100 px-2.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function ChoiceChips({
  item,
  onChange,
  now,
}: {
  item: Pick<
    QueueItem,
    "id" | "requires" | "choices" | "suggestions" | "template" | "format" | "result"
  >;
  onChange: (choices: UploadChoices) => void;
  now: Date;
}) {
  const suggested = useMemo(
    () => new Set(item.suggestions.period.map((p) => p.month)),
    [item.suggestions.period],
  );
  const months = useMemo(
    () => monthOptions(now, [...suggested, ...(item.choices.month ? [item.choices.month] : [])]),
    [now, suggested, item.choices.month],
  );
  const isSie = item.format === "sie";
  if (isSie) {
    const company = item.result?.companies[0];
    return company ? (
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-ljusgra bg-card px-3 py-1.5 text-sm">
          <Building2 aria-hidden="true" className="size-4 text-antracit-300" />
          {COMPANY_FILTER_LABELS[company]}{" "}
          <span className="text-muted-foreground">(från organisationsnumret)</span>
        </span>
      </div>
    ) : null;
  }
  const { requires, choices } = item;
  if (!requires.month && !requires.company && !requires.asOfDate) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="choice-chips">
      {requires.month ? (
        <Chip icon={<CalendarDays />} label="Månad" missing={!choices.month}>
          {(id) => (
            <select
              id={id}
              className={chipControl}
              value={choices.month ?? ""}
              data-testid="choice-month"
              onChange={(e) => onChange({ month: e.target.value || undefined })}
            >
              <option value="">Välj månad</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                  {suggested.has(m.value) ? " (förslag)" : ""}
                </option>
              ))}
            </select>
          )}
        </Chip>
      ) : null}
      {requires.company ? (
        <Chip icon={<Building2 />} label="Bolag" missing={!choices.company}>
          {(id) => (
            <select
              id={id}
              className={chipControl}
              value={choices.company ?? ""}
              data-testid="choice-company"
              onChange={(e) =>
                onChange({ company: (e.target.value || undefined) as CompanyCode | undefined })
              }
            >
              <option value="">Välj bolag</option>
              {COMPANY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {COMPANY_FILTER_LABELS[c]}
                  {item.suggestions.company?.company === c ? " (förslag)" : ""}
                </option>
              ))}
            </select>
          )}
        </Chip>
      ) : null}
      {requires.asOfDate ? (
        <Chip icon={<CalendarCheck />} label="Exportdatum" missing={!choices.asOfDate}>
          {(id) => (
            <input
              id={id}
              type="date"
              className={chipControl}
              value={choices.asOfDate ?? ""}
              data-testid="choice-asof"
              onChange={(e) => onChange({ asOfDate: e.target.value || undefined })}
            />
          )}
        </Chip>
      ) : null}
    </div>
  );
}
