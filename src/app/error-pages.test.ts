import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";

// next/font needs the Next compiler; the page only reads the generated class name.
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-montserrat-test", className: "", style: {} }),
}));

describe("not-found page", () => {
  const html = renderToStaticMarkup(createElement(NotFound));

  it("says in Swedish that the page does not exist and links to Översikt", () => {
    expect(html).toContain("Sidan finns inte");
    const link = /<a ([^>]*)>Till Översikt<\/a>/.exec(html)?.[1] ?? "";
    expect(link).toContain('href="/"');
    expect(link).toContain('data-testid="not-found-home"');
    expect(html).toContain("<h1");
  });
});

describe("error page", () => {
  const secret = new Error("relation metric_values: 811218-9876 leaked");
  secret.stack = "Error: boom\n    at Page (src/app/(app)/page.tsx:12:5)";
  const render = (digest?: string) =>
    renderToStaticMarkup(
      createElement(ErrorPage, {
        error: Object.assign(secret, digest ? { digest } : {}),
        retry: () => undefined,
      }),
    );

  it("is Swedish, offers retry and a way home", () => {
    const html = render();
    expect(html).toContain("Något gick fel");
    expect(html).toContain('data-testid="error-retry"');
    expect(html).toContain("Försök igen");
    expect(html).toMatch(/href="\/"[^>]*>Till Översikt</);
  });

  it("never shows the message or the stack, only the digest", () => {
    const html = render("4711abc");
    expect(html).not.toContain("metric_values");
    expect(html).not.toContain("811218");
    expect(html).not.toContain("page.tsx");
    expect(html).toContain("Felkod: 4711abc");
  });
});

describe("global error page", () => {
  const secret = new Error("root layout failed: 811218-9876");
  secret.stack = "Error: boom\n    at RootLayout (src/app/layout.tsx:3:1)";
  const render = (digest?: string) =>
    renderToStaticMarkup(
      createElement(GlobalError, {
        error: Object.assign(secret, digest ? { digest } : {}),
        retry: () => undefined,
      }),
    );

  it("renders its own Swedish document with the brand font, a heading and retry", () => {
    const html = render();
    expect(html).toMatch(/^<html lang="sv" class="font-montserrat-test/);
    expect(html).toContain("<body");
    expect(html).toMatch(/<h1[^>]*>Något gick fel/);
    expect(html).toContain('data-testid="global-error-retry"');
    expect(html).toContain('type="button"');
  });

  it("never shows the message or the stack, only the digest", () => {
    const html = render("c0ffee");
    expect(html).not.toContain("root layout failed");
    expect(html).not.toContain("811218");
    expect(html).not.toContain("layout.tsx");
    expect(html).toContain("Felkod: c0ffee");
  });
});
