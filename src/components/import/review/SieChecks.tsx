"use client";

import { COMPANY_FILTER_LABELS, type IngestResult } from "@/lib/contracts";
import { formatAmount, formatNumber } from "@/lib/core/format-sv";
import { formatMonthShort } from "@/lib/core/month";
import { formatMonthSpan, monthsAfterExport } from "@/lib/import-ui/months";

const ENCODING_LABELS: Record<string, string> = {
  cp437: "PC8 (CP437)",
  "windows-1252": "Windows-1252",
  "utf-8": "UTF-8",
};

/** Checks for a Fortnox SIE file: company, control totals per month and year to date, #RES, encoding. */
export function SieChecks({ result }: { result: IngestResult }) {
  const checks = result.ledger?.checks;
  if (!checks) return null;
  const after = monthsAfterExport(result);
  return (
    <div className="flex flex-col gap-5 text-sm" data-testid="sie-checks">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Bolag</dt>
        <dd className="font-medium">
          {checks.company
            ? `${COMPANY_FILTER_LABELS[checks.company]} (org.nr ${checks.orgNr})`
            : "Okänt – filen kan inte publiceras"}
        </dd>
        <dt className="text-muted-foreground">Teckenkodning</dt>
        <dd>
          {ENCODING_LABELS[checks.encoding] ?? checks.encoding}
          {checks.declaredFormat ? ` (filen säger ${checks.declaredFormat})` : ""}
        </dd>
        <dt className="text-muted-foreground">Räkenskapsår</dt>
        <dd>
          {checks.fiscalYears
            .filter((y) => y.yearNo === 0)
            .map((y) => `${y.start} – ${y.end}`)
            .join(", ") || "–"}
        </dd>
        <dt className="text-muted-foreground">Årsbelopp mot #RES</dt>
        <dd>
          {checks.resCheck.ok
            ? "Stämmer"
            : `${checks.resCheck.mismatches.length} konton stämmer inte (till exempel ${checks.resCheck.mismatches
                .slice(0, 3)
                .map((m) => m.account)
                .join(", ")})`}
        </dd>
        {after.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Efter exportdatumet</dt>
            <dd>{formatMonthSpan(after)}</dd>
          </>
        ) : null}
      </dl>

      {checks.warnings.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="sie-warnings">
          <p className="font-medium">Att kontrollera</p>
          <ul className="list-disc pl-5">
            {checks.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {checks.resultPerMonth.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Kontrollsumma: stäm av mot Fortnox resultatrapport</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Resultat per månad och hittills i år</caption>
              <thead className="text-[11px] tracking-[0.06em] text-antracit-300 uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Månad
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Resultat
                  </th>
                </tr>
              </thead>
              <tbody>
                {checks.resultPerMonth.map((r) => (
                  <tr key={r.month} className="border-t border-border">
                    <td className="px-3 py-1.5">{formatMonthShort(r.month)}</td>
                    <td className="num px-3 py-1.5 text-right">{formatAmount(r.result)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <th scope="row" className="px-3 py-2 text-left">
                    Hittills i år
                  </th>
                  <td className="num px-3 py-2 text-right">{formatAmount(checks.resultYtd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}

      {result.ledger ? (
        <p className="num text-muted-foreground">
          {formatNumber(result.ledger.rows.length)} saldon på{" "}
          {formatNumber(result.ledger.accounts.length)} konton och{" "}
          {formatNumber(result.ledger.objects.length)} kostnadsställen.
        </p>
      ) : null}
    </div>
  );
}
