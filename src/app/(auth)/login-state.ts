// Shared by the login form (client) and the login action (server). Keep this file free of
// server-only imports: it is bundled for the browser.

export const PASSWORD_MAX_LENGTH = 256;

export interface LoginState {
  error: string | null;
}

export const INITIAL_LOGIN_STATE: LoginState = { error: null };
