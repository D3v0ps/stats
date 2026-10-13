import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import "./globals.css";

// Montserrat (SIL OFL 1.1, see ./fonts/OFL.txt), self-hosted so builds never depend on Google Fonts.
const montserrat = localFont({
  src: [{ path: "./fonts/Montserrat-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "MB Stats", template: "%s · MB Stats" },
  description: "Statistik och styrelserapport för Miljonbemanning.",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#1E252B",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request, /_not-found included: only then does Next stamp the proxy's CSP nonce
  // on the scripts. A prerendered page has none and would never hydrate.
  await connection();
  return (
    <html lang="sv" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
