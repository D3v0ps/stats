"use client";

import localFont from "next/font/local";
import "./globals.css";

// global-error replaces the root layout, so it brings its own styles and font.
const montserrat = localFont({
  src: [{ path: "./fonts/Montserrat-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-montserrat",
  display: "swap",
});

/**
 * Last-resort error page (the root layout itself failed). Swedish, brand styled, without the
 * error's message or stack; the digest matches the server log.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="sv" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full">
        <title>Något gick fel · MB Stats</title>
        <main className="flex min-h-dvh items-center justify-center bg-antracit px-4 py-16 text-white">
          <section role="alert" aria-labelledby="global-error-title" className="w-full max-w-lg">
            <h1
              id="global-error-title"
              className="text-3xl leading-tight font-light tracking-[0.08em] text-balance uppercase md:text-4xl"
            >
              Något gick fel
              <span className="text-rod" aria-hidden="true">
                .
              </span>
            </h1>
            <p className="mt-4 text-sm text-pretty text-antracit-100">
              MB Stats kunde inte startas just nu. Försök igen om en stund. Om felet finns kvar,
              ladda om sidan.
            </p>
            {error.digest ? (
              <p className="num mt-3 text-xs text-antracit-200">Felkod: {error.digest}</p>
            ) : null}
            <button
              type="button"
              onClick={() => retry()}
              data-testid="global-error-retry"
              className="mt-8 inline-flex h-9 items-center rounded-lg bg-white px-4 text-sm font-medium text-antracit outline-none hover:bg-ljusgra-100 focus-visible:ring-3 focus-visible:ring-bla"
            >
              Försök igen
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
