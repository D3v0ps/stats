import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ipHash,
  LOGIN_ERROR,
  LOGIN_THROTTLE_CONFIG_ERROR,
  LOGOUT_EVERYWHERE_FAILED_QUERY,
  MIN_RESPONSE_MS,
} from "./login-security";
import { INITIAL_LOGIN_STATE } from "./login-state";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  createAdminClient: vi.fn(),
  getSessionOrNull: vi.fn(),
  headers: new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
  cookieStore: {
    getAll: vi.fn(() => [] as { name: string; value: string }[]),
    delete: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => mocks.headers,
  cookies: async () => mocks.cookieStore,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("@/lib/db/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/db/client-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
}));
vi.mock("@/lib/db/session", () => ({
  LOGIN_PATH: "/logga-in",
  getSessionOrNull: mocks.getSessionOrNull,
}));

const { login, logout, logoutEverywhere } = await import("./actions");

const EMAIL = "stats-user@example.invalid";
const HASH = ipHash("203.0.113.7", EMAIL);

function form(password: string | null) {
  const data = new FormData();
  if (password !== null) data.set("password", password);
  return data;
}

/** Runs the action under fake timers and reports how long it took (in fake ms). */
async function run<T>(
  action: () => Promise<T>,
): Promise<{ result?: T; error?: Error; ms: number }> {
  const start = Date.now();
  const promise = action().then(
    (result) => ({ result }),
    (error: Error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const settled = await promise;
  return { ...settled, ms: Date.now() - start };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("STATS_LOGIN_EMAIL", EMAIL);
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockImplementation(async (fn: string) =>
    fn === "login_gate"
      ? { data: { allowed: true, retry_after_s: 0, delay_ms: 0 }, error: null }
      : { data: null, error: null },
  );
  mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.cookieStore.getAll.mockReturnValue([]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("login", () => {
  it("signs in with the configured e-mail, records success and redirects home", async () => {
    const { error, ms } = await run(() => login(INITIAL_LOGIN_STATE, form("rätt lösenord")));
    expect(error?.message).toBe("REDIRECT /");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: "rätt lösenord",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "login_gate", { p_ip_hash: HASH });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "login_record", { p_ip_hash: HASH, p_ok: true });
    expect(ms).toBeGreaterThanOrEqual(MIN_RESPONSE_MS);
  });

  it("counts failed attempts so the form can announce a repeated error", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    const first = await run(() => login(INITIAL_LOGIN_STATE, form("fel")));
    expect(first.result).toEqual({ error: LOGIN_ERROR, attempt: 1 });
    const second = await run(() => login(first.result!, form("fel igen")));
    expect(second.result).toEqual({ error: LOGIN_ERROR, attempt: 2 });
  });

  it("never sends the raw IP to the database", async () => {
    await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("203.0.113.7");
  });

  it("returns the generic error for a wrong password and records the failure", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    const { result, ms } = await run(() => login(INITIAL_LOGIN_STATE, form("fel")));
    expect(result).toMatchObject({ error: LOGIN_ERROR });
    expect(mocks.rpc).toHaveBeenLastCalledWith("login_record", { p_ip_hash: HASH, p_ok: false });
    expect(ms).toBeGreaterThanOrEqual(MIN_RESPONSE_MS);
  });

  it("does not try the password while the gate is closed", async () => {
    mocks.rpc.mockResolvedValue({
      data: { allowed: false, retry_after_s: 600, delay_ms: 0 },
      error: null,
    });
    const { result } = await run(() => login(INITIAL_LOGIN_STATE, form("gissning")));
    expect(result).toMatchObject({ error: LOGIN_ERROR });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("waits the global slow-down before trying", async () => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "login_gate"
        ? { data: { allowed: true, retry_after_s: 0, delay_ms: 2000 }, error: null }
        : { data: null, error: null },
    );
    const { ms } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(ms).toBeGreaterThanOrEqual(2000);
  });

  it("fails closed when the gate RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    const { result } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(result).toMatchObject({ error: LOGIN_ERROR });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("fails closed when the secret key is set but no admin client can be made", async () => {
    mocks.createAdminClient.mockReturnValue(null);
    const { result } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(result).toMatchObject({ error: LOGIN_ERROR });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized passwords with the same message, without asking Auth", async () => {
    for (const password of [null, "", "x".repeat(300)]) {
      const { result, ms } = await run(() => login(INITIAL_LOGIN_STATE, form(password)));
      expect(result).toMatchObject({ error: LOGIN_ERROR });
      expect(ms).toBeGreaterThanOrEqual(MIN_RESPONSE_MS);
    }
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not count network failures as guesses", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    const { result } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(result).toMatchObject({ error: LOGIN_ERROR });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses to log in without the secret key in production", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const { result } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(result).toMatchObject({ error: LOGIN_THROTTLE_CONFIG_ERROR });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("skips the throttle with a warning in development", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const { error } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(error?.message).toBe("REDIRECT /");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("explains a missing configuration instead of crashing", async () => {
    vi.stubEnv("STATS_LOGIN_EMAIL", "");
    const { result } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(result?.error).toMatch(/inte konfigurerad/);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("turns unexpected exceptions into the generic error", async () => {
    mocks.signInWithPassword.mockRejectedValue(new TypeError("boom"));
    const { result } = await run(() => login(INITIAL_LOGIN_STATE, form("x")));
    expect(result).toMatchObject({ error: LOGIN_ERROR });
  });
});

describe("logout", () => {
  const authCookies = [
    { name: "sb-abcdefgh-auth-token.0", value: "a" },
    { name: "sb-abcdefgh-auth-token.1", value: "b" },
    { name: "sb-abcdefgh-auth-token-code-verifier", value: "c" },
    { name: "theme", value: "x" },
  ];

  it("signs out locally and returns to the login page", async () => {
    const { error } = await run(() => logout());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(error?.message).toBe("REDIRECT /logga-in");
    // A successful signOut clears its own cookies through the Supabase client.
    expect(mocks.cookieStore.delete).not.toHaveBeenCalled();
  });

  it("still clears the session cookies when Auth cannot be reached", async () => {
    mocks.cookieStore.getAll.mockReturnValue(authCookies);
    mocks.signOut.mockResolvedValue({ error: new AuthRetryableFetchError("fetch failed", 0) });
    const { error } = await run(() => logout());
    expect(error?.message).toBe("REDIRECT /logga-in");
    expect(mocks.cookieStore.delete.mock.calls.map(([c]) => c)).toEqual([
      { name: "sb-abcdefgh-auth-token.0", path: "/" },
      { name: "sb-abcdefgh-auth-token.1", path: "/" },
      { name: "sb-abcdefgh-auth-token-code-verifier", path: "/" },
    ]);
  });

  it("clears the session cookies when signOut throws", async () => {
    mocks.cookieStore.getAll.mockReturnValue(authCookies);
    mocks.signOut.mockRejectedValue(new TypeError("lock"));
    const { error } = await run(() => logout());
    expect(error?.message).toBe("REDIRECT /logga-in");
    expect(mocks.cookieStore.delete).toHaveBeenCalledTimes(3);
  });

  it("says so when signing out everywhere fails, and signs this browser out anyway", async () => {
    mocks.getSessionOrNull.mockResolvedValueOnce({ userId: "u" });
    mocks.cookieStore.getAll.mockReturnValue(authCookies);
    mocks.signOut.mockResolvedValue({ error: new AuthRetryableFetchError("fetch failed", 0) });
    const { error } = await run(() => logoutEverywhere());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(error?.message).toBe(`REDIRECT /logga-in?${LOGOUT_EVERYWHERE_FAILED_QUERY}`);
    expect(mocks.cookieStore.delete).toHaveBeenCalledTimes(3);
  });

  it("signs out everywhere only with a session", async () => {
    mocks.getSessionOrNull.mockResolvedValueOnce({ userId: "u" });
    await run(() => logoutEverywhere());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });

    mocks.signOut.mockClear();
    mocks.getSessionOrNull.mockResolvedValueOnce(null);
    const { error } = await run(() => logoutEverywhere());
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(error?.message).toBe("REDIRECT /logga-in");
  });
});
