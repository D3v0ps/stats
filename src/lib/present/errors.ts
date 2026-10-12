// User-facing messages for failures while resolving, saving or freezing a report. Our own
// errors carry Swedish messages; anything else (network, PostgREST) gets a calm generic
// text, so no technical detail or payload reaches the screen.
import { FormulaSyntaxError, MetricConfigError, PersonalDataError } from "@/lib/metrics";

export const GENERIC_REPORT_ERROR =
  "Rapporten kunde inte tas fram just nu. Försök igen om en stund.";

/** Postgres check_violation: raised by our triggers with Swedish messages. */
const CHECK_VIOLATION = "23514";

export function describeReportError(error: unknown, fallback = GENERIC_REPORT_ERROR): string {
  if (
    error instanceof PersonalDataError ||
    error instanceof MetricConfigError ||
    error instanceof FormulaSyntaxError
  ) {
    return error.message;
  }
  if (
    error instanceof Error &&
    error.name === "DbError" &&
    (error as Error & { code?: unknown }).code === CHECK_VIOLATION
  ) {
    return error.message;
  }
  return fallback;
}
