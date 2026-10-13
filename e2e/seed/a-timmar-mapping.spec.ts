// Spec A: the first upload of the messy Intelliplan time report. The September file is mapped
// by hand (dataset, a column left out, six steps, a counter, the company), its new customers are
// accepted in the review and it is published; the August file is then read with the saved
// template by itself. The other projects read this data.
import type { Locator } from "@playwright/test";
import { formatMonthShort } from "@/lib/core/month";
import { expect, test } from "../fixtures";
import {
  distinctValues,
  fixtureFile,
  metricName,
  reviewText,
  total,
  truthCounts,
  truthFacts,
} from "../helpers/truth";
import {
  SLOW,
  addFiles,
  expectPhase,
  expectStatus,
  openUploadPage,
  queueCard,
  reviewPanel,
} from "../helpers/upload";

const SEP = "intelliplan_timmar_MBAB_2026-09.xlsx";
const AUG = "intelliplan_timmar_MBAB_2026-08.xlsx";
const PRESENTATION_CUSTOMER = "Miljonbemanning Presentation (Stockholm)";

test("timmar: map the September file by hand, publish it, then August by itself", async ({
  page,
}) => {
  const sep = truthFacts(SEP);
  const aug = truthFacts(AUG);
  const counts = truthCounts(SEP);
  const filtered =
    (counts.filteredPresentationCustomer ?? 0) +
    (counts.filteredUnstaffed ?? 0) +
    (counts.filteredCancelled ?? 0);

  await openUploadPage(page);
  await expect(page.getByTestId("drop-zone")).toContainText("Släpp månadens filer här");

  const workerStarted = page.waitForEvent("worker");
  await addFiles(page, [fixtureFile(AUG), fixtureFile(SEP)]);
  // The ingest worker falls back to the main thread without telling the UI; a blocked worker
  // (for instance by a CSP) must still fail this spec.
  const worker = await workerStarted;
  let workerClosed = false;
  worker.on("close", () => (workerClosed = true));

  await expectStatus(queueCard(page, SEP), "new");
  await expectStatus(queueCard(page, AUG), "new");
  await expect(page.getByTestId("queue-counts")).toHaveText("2 filer · 2 behöver dig");
  await expect(queueCard(page, SEP).getByTestId("status-chip")).toHaveText("Ny rapporttyp – mappa");

  // Mapping.
  await queueCard(page, SEP).getByTestId("map-button").click();
  const mapping = page.getByTestId("mapping-view");
  await expect(page.getByRole("heading", { level: 2, name: "Mappa rapporten" })).toBeVisible();
  await expect(mapping).toContainText(/blad Tidrapport · \d+ rader/);
  // Personal columns start removed; personnummer cannot be kept at all.
  await expect(
    page.getByTestId("removed-row").filter({ hasText: "Personnummer sparas aldrig." }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Behåll kolumnen Personnummer" })).toBeDisabled();
  await expect(page.getByTestId("removed-row").filter({ hasText: "Konsult" })).toContainText(
    "Personuppgift",
  );

  await page.getByTestId("dataset-select").selectOption("ip_timmar");
  await expect(page.getByLabel("Mått för kolumnen timmar", { exact: true })).toHaveValue("timmar");
  await expect(page.getByTestId("template-name")).toHaveValue("Intelliplan – timmar och pass");
  // Status is only needed by a filter step.
  await page.getByLabel("Användning för kolumnen status", { exact: true }).selectOption("ignore");

  const steps = page.getByTestId("step-list").getByRole("listitem");
  const addTool = async (kind: string, fill: (dialog: Locator) => Promise<void>) => {
    const before = await steps.count();
    await page.getByTestId(`tool-${kind}`).click();
    const dialog = page.getByTestId("tool-dialog");
    await expect(dialog).toBeVisible();
    await fill(dialog);
    await dialog.getByTestId("tool-dialog-submit").click();
    await expect(dialog).toBeHidden();
    await expect(steps).toHaveCount(before + 1);
  };

  await addTool("filter", async (d) => {
    await d.getByTestId("tool-column").selectOption("kund");
    await d.getByLabel("Villkor").selectOption("equals");
    await d.getByTestId("tool-value").fill(PRESENTATION_CUSTOMER);
  });
  await addTool("filter", async (d) => {
    await d.getByTestId("tool-column").selectOption("anställnings id");
    await d.getByLabel("Villkor").selectOption("empty");
  });
  await addTool("filter", async (d) => {
    await d.getByTestId("tool-column").selectOption("status");
    await d.getByLabel("Villkor").selectOption("equals");
    await d.getByTestId("tool-value").fill("Makulerad");
  });
  await addTool("clean", async (d) => {
    await d.getByTestId("tool-column").selectOption("timmar");
    await d.getByLabel("Vad står i kolumnen?").selectOption("hours");
  });
  await addTool("replace", async (d) => {
    await d.getByTestId("tool-column").selectOption("kund");
    await d.getByTestId("tool-find").fill("Postnord");
    await d.getByTestId("tool-replace").fill("PostNord AB");
    await d.getByLabel("Var?", { exact: true }).selectOption("whole_cell");
  });
  await addTool("constant", async (d) => {
    await d.getByTestId("tool-column").fill("verksamhet");
    await d.getByTestId("tool-value").fill("Bemanning");
  });
  await page
    .getByLabel("Användning för kolumnen verksamhet", { exact: true })
    .selectOption("dimension");
  await page
    .getByLabel("Gruppera på för kolumnen verksamhet", { exact: true })
    .selectOption("verksamhet");
  await addTool("counter", async (d) => {
    await d.getByTestId("tool-metric").selectOption("pass");
  });
  await expect(page.getByTestId("step-list")).toContainText("Räkna rader som ”Pass”");

  await page.getByTestId("company-mbab").check();
  await expect(mapping).toContainText(
    `Visar 20 av ${counts.includedShifts} rader efter stegen, ${filtered} rader bortfiltrerade.`,
  );

  await page.getByTestId("save-template-button").click();

  // Review: the customers are new to the catalog, so the review stops and asks first.
  const panel = reviewPanel(page, SEP);
  await expectPhase(panel, "values");
  const customers = distinctValues(sep, "timmar", "kund").length;
  await expect(panel.getByTestId("unknown-values")).toContainText(`Kund (${customers} nya)`);
  await panel.getByRole("button", { name: "Lägg till alla som nya" }).click();
  await expectPhase(panel, "ready");
  await expect(panel).toContainText(
    `Intelliplan – timmar och pass · ${formatMonthShort("2026-09")} · MB AB`,
  );

  const table = panel.getByTestId("comparison-table");
  const hoursRow = table.getByRole("row").filter({ hasText: metricName("timmar") });
  await expect(hoursRow).toContainText("MB AB");
  await expect(hoursRow).toContainText(formatMonthShort("2026-09"));
  await expect(hoursRow).toContainText(reviewText("timmar", total(sep, "timmar")));
  await expect(table.getByRole("row").filter({ hasText: metricName("pass") })).toContainText(
    reviewText("pass", total(sep, "pass")),
  );
  await expect(panel).toContainText("Inga avvikelser över 25 % mot föregående månad.");

  await panel.getByTestId("publish-button").click();
  await expect(panel.getByTestId("published-summary")).toHaveText(
    `Publicerat: 2 mått, ${formatMonthShort("2026-09")}, MB AB.`,
    SLOW,
  );

  // Back in the queue, the saved template has already read the August file.
  await page.getByTestId("back-button").click();
  await expectStatus(queueCard(page, SEP), "published");
  await expect(queueCard(page, SEP).getByTestId("status-chip")).toHaveText("Publicerad");
  await expectStatus(queueCard(page, AUG), "ready");

  await queueCard(page, AUG).getByTestId("review-button").click();
  const augPanel = reviewPanel(page, AUG);
  await expectPhase(augPanel, "ready");
  await expect(
    augPanel
      .getByTestId("comparison-table")
      .getByRole("row")
      .filter({
        hasText: metricName("timmar"),
      }),
  ).toContainText(reviewText("timmar", total(aug, "timmar")));
  await augPanel.getByTestId("publish-button").click();
  await expect(augPanel.getByTestId("published-summary")).toHaveText(
    `Publicerat: 2 mått, ${formatMonthShort("2026-08")}, MB AB.`,
    SLOW,
  );

  await page.getByTestId("back-button").click();
  await expect(page.getByTestId("queue-counts")).toHaveText("2 filer · 2 publicerade");
  expect(workerClosed, "the ingest worker stopped and parsing fell back").toBe(false);
});
