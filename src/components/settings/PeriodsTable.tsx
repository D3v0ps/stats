"use client";

import { Lock } from "lucide-react";
import { useOptimistic } from "react";
import { setPeriodClosedAction } from "@/app/(app)/installningar/actions";
import { Button } from "@/components/ui/button";
import type { CompanyCode } from "@/lib/contracts/domain";
import { formatDateSv } from "@/lib/core/format-sv";
import { formatMonthLong } from "@/lib/core/month";
import type { PeriodRow } from "@/lib/settings-ui/periods";
import { SettingsCard } from "./ui";
import { useSettingsAction } from "./use-settings-action";

interface Toggle {
  month: string;
  company: CompanyCode;
  closedAt: string | null;
}

function applyToggle(rows: PeriodRow[], t: Toggle): PeriodRow[] {
  return rows.map((r) =>
    r.month === t.month
      ? {
          ...r,
          cells: { ...r.cells, [t.company]: { ...r.cells[t.company], closedAt: t.closedAt } },
        }
      : r,
  );
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("sv") + text.slice(1);

export function PeriodsTable({
  rows,
  companies,
}: {
  rows: PeriodRow[];
  companies: { code: CompanyCode; shortName: string }[];
}) {
  const [optimisticRows, toggle] = useOptimistic(rows, applyToggle);
  const { pending, run } = useSettingsAction();

  function setClosed(month: string, company: CompanyCode, closed: boolean) {
    run(
      setPeriodClosedAction,
      { company, month, closed },
      // The real timestamp arrives with the refreshed page; until then "just nu" is shown.
      { optimistic: () => toggle({ month, company, closedAt: closed ? "" : null }) },
    );
  }

  return (
    <SettingsCard className="p-0 md:p-0">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[10rem_repeat(2,minmax(0,1fr))] gap-6 px-6 pt-5 pb-3 text-xs font-medium text-muted-foreground sm:grid"
      >
        <span>Månad</span>
        {companies.map((c) => (
          <span key={c.code}>{c.shortName}</span>
        ))}
      </div>
      <ul data-testid="periods-table">
        {optimisticRows.map((row) => {
          const monthLabel = capitalize(formatMonthLong(row.month));
          return (
            <li
              key={row.month}
              className="grid gap-4 border-t px-5 py-4 first:border-t-0 sm:grid-cols-[10rem_repeat(2,minmax(0,1fr))] sm:gap-6 sm:px-6 sm:first:border-t"
              data-testid={`period-${row.month}`}
            >
              <p className="font-medium">{monthLabel}</p>
              {companies.map((c) => {
                const cell = row.cells[c.code];
                const closed = cell.closedAt !== null;
                return (
                  <div key={c.code} className="flex flex-col items-start gap-2">
                    <span className="text-xs font-medium sm:sr-only">{c.shortName}</span>
                    <span className="text-xs text-muted-foreground">
                      {cell.datasets.length === 0 ? "Ingen data" : cell.datasets.join(", ")}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {closed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-antracit px-2.5 py-0.5 text-xs text-white">
                          <Lock aria-hidden="true" className="size-3" />
                          Stängd
                          {cell.closedAt ? ` ${formatDateSv(cell.closedAt)}` : " just nu"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-ljusgra-200 px-2.5 py-0.5 text-xs">
                          Öppen
                        </span>
                      )}
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setClosed(row.month, c.code, !closed)}
                        aria-label={`${closed ? "Öppna" : "Stäng"} ${formatMonthLong(row.month)} för ${c.shortName}`}
                        data-testid={`period-toggle-${c.code}`}
                      >
                        {closed ? "Öppna igen" : "Stäng"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
