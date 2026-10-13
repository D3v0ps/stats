// Shared steps of the upload specs (/ladda-upp). Files are dropped through the hidden file
// input; cards and review panels are awaited on their data-status / data-phase attributes.
import { expect, type Locator, type Page } from "@playwright/test";
import { formatDateSv } from "@/lib/core/format-sv";

/**
 * The browser clock for upload specs. Open months (current month or later) and the suggested
 * export date come from it; the server's clock still dates publications.
 */
export const FIXED_NOW = new Date("2026-10-13T10:00:00+02:00");

/** Reading, recognising, staging and comparing a file are chains of worker calls and actions. */
export const SLOW = { timeout: 90_000 };

export async function openUploadPage(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  // The page warns before unloading while a file is unfinished; leaving must still work.
  page.on("dialog", (dialog) =>
    dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss(),
  );
  await page.goto("/ladda-upp");
  await expect(page.getByRole("heading", { level: 1, name: "Ladda upp" })).toBeVisible();
}

export async function addFiles(page: Page, files: string[]) {
  await page.getByTestId("file-input").setInputFiles(files);
}

/** The queue card of a file. Use the full file name: names share long prefixes. */
export function queueCard(page: Page, fileName: string): Locator {
  return page.getByTestId("queue-card").filter({ hasText: fileName });
}

export function reviewPanel(page: Page, fileName: string): Locator {
  return page.getByTestId("review-panel").filter({ hasText: fileName });
}

export async function expectStatus(card: Locator, status: string) {
  await expect(card).toHaveAttribute("data-status", status, SLOW);
}

export async function expectPhase(panel: Locator, phase: string) {
  await expect(panel).toHaveAttribute("data-phase", phase, SLOW);
}

/** Server-side publication dates as the app prints them, e.g. "13 okt 2026". */
export function serverDateToday(): string {
  return formatDateSv(new Date().toISOString());
}

export async function removeFromQueue(page: Page, fileName: string) {
  await page.getByRole("button", { name: `Ta bort ${fileName} ur listan` }).click();
  await expect(queueCard(page, fileName)).toHaveCount(0);
}
