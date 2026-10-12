// Revenue per customer (Fortnox kundförsäljning) never covers the books exactly: credit notes,
// accruals and revenue booked without a customer differ. Grouped by kund, the table gets a
// "Skillnad mot bokfört" row = booked revenue (ledger, same company and window) − Σ customers,
// so the total always matches the books.
import type { ComparisonKind } from "@/lib/contracts/domain";
import type { DimFilter, MetricResult } from "@/lib/contracts/metric-query";

export const BOOKED_REMAINDER_LABEL = "Skillnad mot bokfört";
export const CUSTOMER_REVENUE_METRIC = "fakturerat_kund";
export const BOOKED_REVENUE_METRIC = "intakter";
const CUSTOMER_DIMENSION = "kund";

/** Only when the whole customer list is shown: a customer filter makes the books incomparable. */
export function needsBookedRemainder(
  metricKeys: readonly string[],
  groupBy: string | null,
  filters: readonly Pick<DimFilter, "dimension">[],
): boolean {
  return (
    metricKeys.includes(CUSTOMER_REVENUE_METRIC) &&
    groupBy === CUSTOMER_DIMENSION &&
    filters.length === 0
  );
}

/** booked − Σ parts (missing parts count as 0); null when the books have no number. */
export function bookedRemainder(
  parts: readonly (number | null)[],
  booked: number | null,
): number | null {
  if (booked === null) return null;
  const diff = parts.reduce<number>((acc, v) => acc - (v ?? 0), booked);
  // Float noise from subtracting sums must not show up as a phantom öre.
  return Math.abs(diff) < 1e-6 ? 0 : diff;
}

export interface RemainderValues {
  value: number | null;
  /** The booked total that the table's total row shows instead of Σ customers. */
  booked: number | null;
  compare: Partial<Record<ComparisonKind, { value: number | null; booked: number | null }>>;
}

/**
 * Remainder for the current window and every comparison both results carry. Budget has no
 * per-customer counterpart, so it is left out.
 */
export function remainderFor(
  customers: MetricResult,
  booked: MetricResult,
): RemainderValues | null {
  if (booked.status !== "ok" || booked.total.value === null) return null;
  const compare: RemainderValues["compare"] = {};
  for (const kind of ["prev_period", "prev_year"] as const) {
    const bookedCell = booked.total.compare[kind];
    if (!bookedCell || !customers.total.compare[kind]) continue;
    compare[kind] = {
      booked: bookedCell.value,
      value: bookedRemainder(
        customers.groups.map((g) => g.compare[kind]?.value ?? null),
        bookedCell.value,
      ),
    };
  }
  return {
    value: bookedRemainder(
      customers.groups.map((g) => g.value),
      booked.total.value,
    ),
    booked: booked.total.value,
    compare,
  };
}
