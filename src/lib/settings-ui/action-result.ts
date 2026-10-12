// What every settings server action returns, and the Swedish text for database errors.
// Messages never echo submitted values (they can be personal data).

export type ActionResult<T = undefined> =
  { ok: true; message: string; data: T } | { ok: false; error: string };

export function ok(message: string): ActionResult;
export function ok<T>(message: string, data: T): ActionResult<T>;
export function ok<T>(message: string, data?: T): ActionResult<T | undefined> {
  return { ok: true, message, data };
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export const GENERIC_ERROR = "Något gick fel. Försök igen om en stund.";

interface ErrorLike {
  name?: string;
  message?: string;
  code?: string | null;
}

/** Our own database and repo messages are Swedish and safe to show as-is. */
const SWEDISH = /[åäöÅÄÖ]|^(?:Okänd|Okänt|Mallen|Måttet|Behörighet|Personnummer|Inget svar)/;

/**
 * A user-facing Swedish message for an error thrown by the repo layer (DbError, plain Error
 * with a Swedish message, or anything else). Postgres error codes are mapped first, because
 * Postgres' own messages are English and may quote values.
 */
export function errorMessage(error: unknown): string {
  const e = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;
  switch (e.code) {
    case "23505":
      return "Det finns redan ett värde med samma namn eller nyckel.";
    case "23503":
      return "Det används av annan data och kan inte ändras eller tas bort.";
    case "23514":
      return e.message && /Personnummer/.test(e.message)
        ? "Personnummer får inte sparas."
        : "Värdet är inte tillåtet.";
    case "42501":
      return "Behörighet saknas.";
    case "22P02":
      return "Ogiltigt värde.";
  }
  if (e.name === "ZodError") return "Ogiltiga uppgifter.";
  if (typeof e.message === "string" && e.message !== "" && SWEDISH.test(e.message)) {
    return e.message;
  }
  return GENERIC_ERROR;
}
