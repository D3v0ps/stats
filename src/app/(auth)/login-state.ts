// Shared by the login form (client) and the login action (server). Keep this file free of
// server-only imports: it is bundled for the browser.

export const PASSWORD_MAX_LENGTH = 256;

export interface LoginState {
  error: string | null;
  /** Failed submissions so far. Keys the error alert so a repeated message is announced again. */
  attempt: number;
}

export const INITIAL_LOGIN_STATE: LoginState = { error: null, attempt: 0 };
