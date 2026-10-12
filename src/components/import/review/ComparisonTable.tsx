"use client";

import { Flag } from "lucide-react";
import { useState } from "react";
import { Delta } from "@/components/brand/Delta";
import { buildDelta } from "@/components/brand/delta-text";
import { formatDeltaPercent, formatValue } from "@/lib/core/format-sv";
import type { ReviewRow } from "@/lib/import-ui/review";
import { cn } from "@/lib/utils";

function delta(row: ReviewRow) {
  if (row.previous === null) return null;
  const pp = row.unit === "pct" ? row.staged - row.previous : null;
  return buildDelta({
    unit: row.unit,
    deltaPct: row.deviationPct,
    deltaPp: pp,
    higherIsBetter: row.higherIsBetter,
    againstLabel: "mot föregående månad",
  });
}

/** Nu / Publicerat i dag / Föregående månad / Förändring per metric × company × month. */
export function ComparisonTable({
  rows,
  thresholdPct,
}: {
  rows: ReviewRow[];
  thresholdPct: number;
}) {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flagged = rows.filter((r) => r.flagged).length;
  const shown = onlyFlagged ? rows.filter((r) => r.flagged) : rows;
  const replacing = rows.some((r) => r.replacing);
  const fmt = (v: number | null, r: ReviewRow) =>
    formatValue(v, r.unit, { decimals: r.decimals ?? undefined });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {flagged === 0
            ? `Inga avvikelser över ${thresholdPct} % mot föregående månad.`
            : `${flagged} ${flagged === 1 ? "värde avviker" : "värden avviker"} mer än ${thresholdPct} % mot föregående månad.`}
        </p>
        {flagged > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-antracit"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            Visa bara avvikelser
          </label>
        ) : null}
      </div>
      <div
        className="max-h-[28rem] overflow-auto rounded-xl border border-border"
        data-testid="comparison-table"
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Jämförelse per mått, bolag och månad</caption>
          <thead className="sticky top-0 z-10 bg-card text-[11px] tracking-[0.06em] text-antracit-300 uppercase">
            <tr>
              {[
                "Mått",
                "Bolag",
                "Månad",
                "Nu",
                ...(replacing ? ["Publicerat i dag"] : []),
                "Föregående månad",
                "Förändring",
              ].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={cn(
                    "border-b border-border px-3 py-2 font-medium whitespace-nowrap",
                    i >= 3 ? "text-right" : "text-left",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const d = delta(r);
              return (
                <tr
                  key={r.key}
                  data-flagged={r.flagged || undefined}
                  className={cn(r.flagged && "bg-rod-100/40")}
                >
                  <th
                    scope="row"
                    className="border-b border-border px-3 py-2 text-left font-medium"
                  >
                    {r.metricName}
                  </th>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap">
                    {r.companyLabel}
                  </td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap">
                    {r.monthLabel}
                  </td>
                  <td className="num border-b border-border px-3 py-2 text-right font-medium whitespace-nowrap">
                    {fmt(r.staged, r)}
                  </td>
                  {replacing ? (
                    <td className="num border-b border-border px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                      {r.replacing ? fmt(r.current, r) : "–"}
                      {r.replacing && r.changePct !== null ? (
                        <span className="block text-[11px]">
                          {formatDeltaPercent(r.changePct, 1)} mot publicerat
                        </span>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="num border-b border-border px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                    {fmt(r.previous, r)}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-2">
                      {r.flagged ? (
                        <Flag
                          role="img"
                          aria-label="Avvikelse"
                          className="size-4 fill-rod text-rod"
                        />
                      ) : null}
                      <Delta delta={d} showAgainst={false} size="sm" />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
