// Turning a failed database or server call into a short Swedish message for the
// upload page. Request payloads are never part of a message.
import { EnvError } from "@/lib/db/env";
import { DbError } from "@/lib/db/repo/shared";

export const GENERIC_ERROR = "Något gick fel. Försök igen om en stund.";
export const DUPLICATE_PUBLISH_ERROR = "Den här filen är redan publicerad med samma mall.";

const SWEDISH =
  /[åäöÅÄÖ]|^(?:Okän|Ogiltig|Uppladdning|Mallen|Filen|Bolag|Kostnadsställe|Inget svar|Objektrad|Avvikelse|Bara )/;

/** A message the user can act on; technical (English) messages become the generic one. */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof EnvError) return error.message;
  if (error instanceof DbError) {
    if (error.code === "23505") return DUPLICATE_PUBLISH_ERROR;
    return SWEDISH.test(error.message) ? error.message : GENERIC_ERROR;
  }
  if (error instanceof Error && error.name !== "ZodError" && SWEDISH.test(error.message)) {
    return error.message.length > 300 ? GENERIC_ERROR : error.message;
  }
  return GENERIC_ERROR;
}
