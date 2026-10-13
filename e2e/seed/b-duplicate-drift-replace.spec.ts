// Spec B: with the timmar template saved (Spec A), a fresh page load recognises files by
// itself. The same file again is a duplicate, a changed file stops before anything is read, and
// the UTF-16 CSV export of the same month replaces the published September numbers.
import { formatNumber } from "@/lib/core/format-sv";
import { formatMonthShort } from "@/lib/core/month";
import { expect, test } from "../fixtures";
import { fixtureFile, metricName, reviewText, total, truthFacts } from "../helpers/truth";
import {
  FIXED_NOW,
  SLOW,
  addFiles,
  expectPhase,
  expectStatus,
  openUploadPage,
  queueCard,
  removeFromQueue,
  reviewPanel,
  serverDateToday,
} from "../helpers/upload";

const SEP = "intelliplan_timmar_MBAB_2026-09.xlsx";
const CHANGED = "intelliplan_timmar_MBAB_2026-09_andrad.xlsx";
const UTF16 = "intelliplan_timmar_MBAB_2026-09_utf16.csv";
const TEMPLATE = "Intelliplan – timmar och pass";

test("timmar: duplicate, changed columns and a replacing re-upload", async ({ page }) => {
  await openUploadPage(page);

  await addFiles(page, [fixtureFile(SEP)]);
  const duplicate = queueCard(page, SEP);
  await expectStatus(duplicate, "duplicate");
  await expect(duplicate.getByTestId("status-chip")).toHaveText("Redan uppladdad");
  await expect(duplicate.getByTestId("queue-message")).toHaveText(
    `Den här filen är redan uppladdad (publicerad ${serverDateToday()}).`,
  );

  await addFiles(page, [fixtureFile(CHANGED)]);
  const changed = queueCard(page, CHANGED);
  await expectStatus(changed, "drift");
  await expect(changed.getByTestId("status-chip")).toHaveText("Filen har ändrats – se skillnaden");
  await expect(changed.getByTestId("review-button")).toHaveCount(0);
  await changed.getByTestId("drift-button").click();
  const drift = page.getByTestId("drift-view");
  await expect(drift).toContainText(`liknar rapporten ”${TEMPLATE}”`);
  await expect(drift).toContainText("Ingenting har lästs in.");
  // fixtures/README.md §2: added, removed and "not compatible" are the contract; a rename is a
  // hint that a similarity-based detector may report as a removed plus an added column.
  const changes = (
    await page.getByTestId("drift-changes").getByRole("listitem").allInnerTexts()
  ).map((text) => text.replace(/\s+/g, " ").trim());
  expect(changes).toContain("Ny kolumn: avdelning");
  const renamed = changes.some((c) =>
    /^Omdöpt kolumn( \(troligen\))?: timmar antal timmar$/.test(c),
  );
  const removedAndAdded =
    changes.includes("Saknad kolumn: timmar") && changes.includes("Ny kolumn: antal timmar");
  expect(renamed || removedAndAdded, `timmar → antal timmar in ${JSON.stringify(changes)}`).toBe(
    true,
  );
  await page.getByTestId("drift-cancel-button").click();
  await removeFromQueue(page, SEP);
  await removeFromQueue(page, CHANGED);

  // Same month, other export format: read with the saved template, then replaces September.
  await addFiles(page, [fixtureFile(UTF16)]);
  const csv = queueCard(page, UTF16);
  await expectStatus(csv, "ready");
  await csv.getByTestId("review-button").click();
  const panel = reviewPanel(page, UTF16);
  await expectPhase(panel, "ready");
  const table = panel.getByTestId("comparison-table");
  await expect(table.getByRole("columnheader", { name: "Publicerat i dag" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: metricName("timmar") })).toContainText(
    reviewText("timmar", total(truthFacts(UTF16), "timmar")),
  );
  await panel.getByTestId("publish-button").click();
  // The year is left out when the replaced version is from the current year.
  const replaced = serverDateToday().replace(` ${FIXED_NOW.getFullYear()}`, "");
  await expect(panel.getByTestId("published-summary")).toHaveText(
    `Publicerat: ${formatNumber(2)} mått, ${formatMonthShort("2026-09")}, MB AB. Ersatte version från ${replaced}.`,
    SLOW,
  );
  await page.getByTestId("back-button").click();
  await expectStatus(csv, "published");

  await page.getByTestId("history-link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Historik" })).toBeVisible();
  const row = (fileName: string) => page.getByTestId("history-row").filter({ hasText: fileName });
  await expect(row(UTF16)).toHaveAttribute("data-status", "published");
  await expect(row(SEP)).toHaveAttribute("data-status", "replaced");
  await expect(row(SEP)).toContainText("Ersatt");
});
