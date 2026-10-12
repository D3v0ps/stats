// "Byt lösenord": the rules checked before calling supabase.auth.updateUser, and Swedish text
// for the Auth errors it can return.

export const MIN_PASSWORD_LENGTH = 16;
/** Supabase Auth hashes with bcrypt, which only uses the first 72 bytes. */
export const MAX_PASSWORD_BYTES = 72;

export interface PasswordIssue {
  /** The field the message belongs to (it is shown under, and marks, that field). */
  field: "new" | "repeat";
  message: string;
}

/** What is wrong with the two fields, or null when the new password can be saved. */
export function newPasswordIssue(password: string, repeat: string): PasswordIssue | null {
  const onNew = (message: string): PasswordIssue => ({ field: "new", message });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return onNew(`Lösenordet måste ha minst ${MIN_PASSWORD_LENGTH} tecken.`);
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return onNew(
      `Lösenordet får vara högst ${MAX_PASSWORD_BYTES} tecken (å, ä och ö räknas som två).`,
    );
  }
  if (password.trim() !== password) {
    return onNew("Lösenordet får inte börja eller sluta med mellanslag.");
  }
  if (password !== repeat) return { field: "repeat", message: "Lösenorden är inte lika." };
  return null;
}

/** Swedish error for the two fields, or null when the new password can be saved. */
export function newPasswordError(password: string, repeat: string): string | null {
  return newPasswordIssue(password, repeat)?.message ?? null;
}

interface AuthErrorLike {
  code?: string;
  status?: number;
  name?: string;
}

/** Text for an error from auth.updateUser (or from creating the client). */
export function passwordChangeError(error: unknown): string {
  const e = (typeof error === "object" && error !== null ? error : {}) as AuthErrorLike;
  switch (e.code) {
    case "same_password":
      return "Det nya lösenordet måste skilja sig från det nuvarande.";
    case "weak_password":
      return "Lösenordet är för svagt. Välj ett längre lösenord med fler olika tecken.";
    case "reauthentication_needed":
    case "session_expired":
    case "session_not_found":
      return "Logga in igen och försök sedan byta lösenord.";
    case "over_request_rate_limit":
      return "För många försök. Vänta en stund och försök igen.";
  }
  if (e.name === "EnvError") return "MB Stats är inte konfigurerad (Supabase saknas).";
  if (e.status === 401 || e.status === 403) return "Logga in igen och försök sedan byta lösenord.";
  return "Lösenordet kunde inte bytas. Försök igen.";
}
