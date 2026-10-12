import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGOUT_EVERYWHERE_FAILED_MESSAGE } from "../login-security";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("../actions", () => ({ login: async () => ({ error: null, attempt: 0 }) }));

const { LoginForm } = await import("./login-form");
const { default: LoginPage } = await import("./page");

function stubEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("STATS_LOGIN_EMAIL", "stats-user@example.invalid");
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await LoginPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("<LoginForm>", () => {
  const html = renderToStaticMarkup(createElement(LoginForm));

  it("has exactly one password field labelled 'Lösenord'", () => {
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>Lösenord<\/label>/);
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('maxLength="256"');
  });

  it("has one 'Logga in' button and nothing else to do", () => {
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>.*Logga in<\/button>/);
    expect(html).not.toMatch(/e-post|email|glömt|registrera|skapa konto/i);
    expect(html).not.toMatch(/<a\s/);
  });
});

describe("login page", () => {
  it("shows the form when Supabase is configured", async () => {
    stubEnv();
    const html = await renderPage();
    expect(html).toContain('type="password"');
    expect(html).toContain("bg-antracit");
    expect(html).not.toContain("Konfiguration saknas");
  });

  it("explains a missing configuration by variable name only", async () => {
    stubEnv();
    vi.stubEnv("STATS_LOGIN_EMAIL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const html = await renderPage();
    expect(html).toContain("Konfiguration saknas");
    expect(html).toContain("STATS_LOGIN_EMAIL");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("abcdefgh");
  });

  it("tells the user when 'Logga ut överallt' did not go through", async () => {
    stubEnv();
    expect(await renderPage({ fel: "utloggning" })).toContain(LOGOUT_EVERYWHERE_FAILED_MESSAGE);
    expect(await renderPage({ fel: "annat" })).not.toContain(LOGOUT_EVERYWHERE_FAILED_MESSAGE);
  });
});
