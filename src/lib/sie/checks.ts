// Review checks for a SIE file: which company it belongs to, which fiscal years
// it covers, the monthly result, and whether the monthly amounts reconcile with
// the file's own #RES balances. Warnings are Swedish (shown in the review step).
import { COMPANIES, type CompanyCode, type LedgerRow, type SieChecks } from "@/lib/contracts";
import type { DecodedSie } from "./decode";
import { fromOre, isResultAccount, toOre, type LedgerResult } from "./ledger";
import type { SieFile } from "./parse";

export interface BuildChecksInput {
  sie: SieFile;
  decoded: Pick<DecodedSie, "encoding" | "declaredFormat" | "warnings">;
  ledger: LedgerResult;
}

/** "556959-9318", "5569599318" or "165569599318" -> "556959-9318". Other input is trimmed. */
export function normalizeOrgNr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("16")) digits = digits.slice(2);
  if (digits.length === 10) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return raw.trim() || null;
}

export function resolveCompany(orgNr: string | null | undefined): CompanyCode | null {
  const normalized = normalizeOrgNr(orgNr);
  if (!normalized) return null;
  const codes = Object.keys(COMPANIES) as CompanyCode[];
  return codes.find((code) => COMPANIES[code].orgNr === normalized) ?? null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Σ öre of the totals rows per month (current year only). */
function currentYearTotals(rows: LedgerRow[]): Map<string, number> {
  const perMonth = new Map<string, number>();
  for (const r of rows) {
    if (r.yearOffset !== 0 || r.dimNo !== null || !isResultAccount(r.account)) continue;
    perMonth.set(r.month, (perMonth.get(r.month) ?? 0) + toOre(r.amount));
  }
  return perMonth;
}

export function buildChecks({ sie, decoded, ledger }: BuildChecksInput): SieChecks {
  const warnings: string[] = [...decoded.warnings];
  const orgNr = normalizeOrgNr(sie.orgnr);
  const company = resolveCompany(orgNr);
  const known = (Object.keys(COMPANIES) as CompanyCode[])
    .map((c) => `${COMPANIES[c].shortName} ${COMPANIES[c].orgNr}`)
    .join(", ");

  if (!orgNr) {
    warnings.push(`Filen saknar #ORGNR. Bolaget kan inte avgöras (${known}).`);
  } else if (!company) {
    warnings.push(
      `Organisationsnumret ${orgNr} hör inte till något av bolagen (${known}). Filen kan inte publiceras.`,
    );
  }

  if (sie.rar.length === 0) {
    warnings.push("Filen saknar #RAR (räkenskapsår).");
  } else if (!sie.rar.some((r) => r.yearNo === 0)) {
    warnings.push("Filen saknar #RAR 0 (innevarande räkenskapsår).");
  }
  if (sie.sietyp === null) warnings.push("Filen saknar #SIETYP.");
  else if (sie.sietyp !== "4")
    warnings.push(`Filen är SIE typ ${sie.sietyp}; SIE typ 4 förväntas.`);

  if (sie.issueCount > 0) {
    warnings.push(`${plural(sie.issueCount, "rad", "rader")} kunde inte tolkas och hoppades över.`);
  }
  const unknown = Object.entries(sie.unknownLabels).sort(([a], [b]) => (a < b ? -1 : 1));
  if (unknown.length > 0) {
    warnings.push(
      `Okända poster ignorerades: ${unknown.map(([label, n]) => `${label} (${n})`).join(", ")}.`,
    );
  }

  const diag = ledger.diagnostics;
  if (diag.multiObjectRowsIgnored > 0) {
    warnings.push(
      `${plural(diag.multiObjectRowsIgnored, "#PSALDO-rad", "#PSALDO-rader")} med flera objekt ignorerades.`,
    );
  }
  if (ledger.psaldoMode === "cumulative") {
    warnings.push("#PSALDO innehåller ackumulerade saldon; de har räknats om till månadsbelopp.");
  }
  if (diag.psaldoModeAssumed) {
    warnings.push(
      "Det gick inte att avgöra om #PSALDO är månadsbelopp eller ackumulerade saldon; månadsbelopp har antagits.",
    );
  }
  if (ledger.usedTransFallback) {
    const years = diag.years.filter((y) => y.source === "trans").map((y) => y.yearNo);
    warnings.push(
      `Filen saknar #PSALDO för resultatkontona (år ${years.join(", ")}); ` +
        "månadsbeloppen har beräknats från verifikationerna.",
    );
  }
  if (diag.transDateOutsideYear > 0) {
    warnings.push(
      `${plural(diag.transDateOutsideYear, "transaktion", "transaktioner")} har transaktionsdatum ` +
        "utanför räkenskapsåret; verifikationsdatumet har använts.",
    );
  }
  if (diag.vouchersWithoutDate > 0) {
    warnings.push(
      `${plural(diag.vouchersWithoutDate, "verifikation", "verifikationer")} saknar giltigt datum och togs inte med.`,
    );
  }
  if (diag.vouchersOutsideYears > 0) {
    warnings.push(
      `${plural(diag.vouchersOutsideYears, "verifikation", "verifikationer")} ligger utanför räkenskapsåren och togs inte med.`,
    );
  }

  // Monthly result of the current year: −Σ totals of accounts 3000–8999.
  const totals = currentYearTotals(ledger.rows);
  const months = [...totals.keys()].sort();
  const resultPerMonth = months.map((month) => ({
    month,
    result: fromOre(-(totals.get(month) ?? 0)),
  }));
  const resultYtd = fromOre(-months.reduce((acc, m) => acc + (totals.get(m) ?? 0), 0));
  if (months.length === 0) {
    warnings.push("Filen innehåller inga belopp på resultatkonton (3000–8999) för innevarande år.");
  }

  // Σ monthly movements per account vs #RES 0.
  const res = new Map<number, number>();
  for (const r of sie.res) {
    if (r.yearNo === 0 && isResultAccount(r.account)) {
      res.set(r.account, (res.get(r.account) ?? 0) + toOre(r.amount));
    }
  }
  const sums = new Map<number, number>();
  for (const r of ledger.rows) {
    if (r.yearOffset === 0 && r.dimNo === null) {
      sums.set(r.account, (sums.get(r.account) ?? 0) + toOre(r.amount));
    }
  }
  const mismatches: SieChecks["resCheck"]["mismatches"] = [];
  if (res.size === 0) {
    warnings.push("Filen saknar #RES för innevarande år; resultatet kunde inte stämmas av.");
  } else {
    const accounts = [...new Set([...res.keys(), ...sums.keys()])].sort((a, b) => a - b);
    for (const account of accounts) {
      const sum = sums.get(account) ?? 0;
      const target = res.get(account) ?? 0;
      if (Math.abs(sum - target) >= 100) {
        mismatches.push({ account, psaldoSum: fromOre(sum), res: fromOre(target) });
      }
    }
    if (mismatches.length > 0) {
      warnings.push(
        `Månadsbeloppen stämmer inte mot #RES för ${plural(mismatches.length, "konto", "konton")}: ` +
          `${mismatches.map((m) => m.account).join(", ")}.`,
      );
    }
  }

  const missingAccounts = [...new Set(ledger.rows.map((r) => r.account))].filter(
    (a) => sie.konto[a] === undefined,
  );
  if (missingAccounts.length > 0) {
    warnings.push(
      `Kontonamn saknas (#KONTO) för: ${missingAccounts.sort((a, b) => a - b).join(", ")}.`,
    );
  }
  const missingObjects = [
    ...new Set(
      ledger.rows
        .filter((r) => r.dimNo !== null && r.objectCode !== null)
        .filter((r) => sie.objekt[r.dimNo as number]?.[r.objectCode as string] === undefined)
        .map((r) => `${r.dimNo}:${r.objectCode}`),
    ),
  ].sort();
  if (missingObjects.length > 0) {
    warnings.push(`Objektnamn saknas (#OBJEKT) för: ${missingObjects.join(", ")}.`);
  }

  return {
    orgNr,
    companyName: sie.fnamn,
    company,
    encoding: decoded.encoding,
    declaredFormat: decoded.declaredFormat,
    fiscalYears: sie.rar.map(({ yearNo, start, end }) => ({ yearNo, start, end })),
    resultPerMonth,
    resultYtd,
    resCheck: { ok: mismatches.length === 0, mismatches },
    usedTransFallback: ledger.usedTransFallback,
    warnings,
  };
}
