// Interpretation of Excel number format codes ("yyyy-mm-dd", "[h]:mm", "0.0%").

/** Remove quoted literals, escapes and bracket sections, keeping elapsed-time brackets ([h]). */
function stripLiterals(fmt: string): string {
  return fmt
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(h+|m+|s+)\]/gi, "$1")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "");
}

/** The format shows a calendar date (year, day or month name), not only a time. */
export function hasDateTokens(fmt: string): boolean {
  const c = stripLiterals(fmt);
  return /[yde]/i.test(c) || /m{3,}/i.test(c);
}

/** A duration/time-of-day format such as "h:mm", "[h]:mm:ss" or "mm:ss". */
export function isTimeOnlyFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const c = stripLiterals(fmt);
  return /[hs]/i.test(c) && c.includes(":") && !hasDateTokens(fmt);
}

/** A percent format: Excel stores 0.125 and shows "12,5 %". */
export function isPercentFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  return stripLiterals(fmt).includes("%");
}
