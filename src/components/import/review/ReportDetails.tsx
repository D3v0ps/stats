"use client";

import type { IngestResult } from "@/lib/contracts";
import { formatNumber } from "@/lib/core/format-sv";
import { emptyDimensionRows, groupSkipped, splitIssues } from "@/lib/import-ui/review";

/** Rows read and used, skipped rows by reason, unreadable cells, empty values and warnings. */
export function ReportDetails({
  result,
  dimensionLabel,
}: {
  result: IngestResult;
  dimensionLabel: (key: string) => string;
}) {
  const report = result.report;
  const groups = groupSkipped(report.skipped.filter((s) => s.reason !== "empty"));
  const { general, cells } = splitIssues(report.issues);
  const empty = emptyDimensionRows(result.facts);
  // A SIE file's warnings are its checks, shown openly next to the control totals.
  const warnings = result.ledger ? [] : report.warnings;
  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="report-details">
      <p className="num">
        <span className="font-medium">{formatNumber(report.rowsRead)}</span> rader lästes,{" "}
        <span className="font-medium">{formatNumber(report.rowsUsed)}</span> användes.
      </p>

      {general.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Problem med mallen</p>
          <ul className="list-disc pl-5">
            {general.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Rader som inte räknades</p>
          <ul className="flex flex-col gap-1.5">
            {groups.map((g) => (
              <li key={g.reason}>
                <details>
                  <summary className="cursor-pointer">
                    {g.label}: <span className="num font-medium">{formatNumber(g.count)}</span>
                  </summary>
                  <ul className="mt-1 pl-5 text-muted-foreground">
                    {g.examples.map((s) => (
                      <li key={`${s.sourceRow}-${s.reason}`} className="num">
                        Rad {s.sourceRow}
                        {s.detail ? `: ${s.detail}` : ""}
                      </li>
                    ))}
                    {g.count > g.examples.length ? (
                      <li>… och {formatNumber(g.count - g.examples.length)} till</li>
                    ) : null}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cells.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Celler som inte kunde läsas ({formatNumber(cells.length)})</p>
          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-[11px] tracking-[0.06em] text-antracit-300 uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Rad
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Kolumn
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Värde
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Varför
                  </th>
                </tr>
              </thead>
              <tbody>
                {cells.slice(0, 100).map((i, k) => (
                  <tr key={k} className="border-t border-border">
                    <td className="num px-3 py-1.5">{i.sourceRow}</td>
                    <td className="px-3 py-1.5">{i.column}</td>
                    <td className="max-w-[12rem] truncate px-3 py-1.5" title={i.value}>
                      {i.value}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {empty.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Tomma värden</p>
          <ul className="list-disc pl-5">
            {empty.map((e) => (
              <li key={e.dimension} className="num">
                {dimensionLabel(e.dimension)} saknas på {formatNumber(e.rows)}{" "}
                {e.rows === 1 ? "rad" : "rader"} (räknas som ”saknas”).
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Att tänka på</p>
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
