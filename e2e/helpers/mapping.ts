// Steps of the mapping view (/ladda-upp → Mappa) shared by the upload specs. Columns are named
// by their working name (the header in lower case), as the view's aria-labels use them.
import { expect, type Locator, type Page } from "@playwright/test";
import { SLOW, queueCard } from "./upload";

export async function openMapping(page: Page, card: Locator) {
  await card.getByTestId("map-button").click();
  await expect(page.getByRole("heading", { level: 2, name: "Mappa rapporten" })).toBeVisible();
  await expect(page.getByTestId("mapping-view")).toBeVisible(SLOW);
}

/** Picks the dataset and waits until its suggestions have replaced the field mappings. */
export async function chooseDataset(page: Page, datasetKey: string, templateName?: string) {
  await page.getByTestId("dataset-select").selectOption(datasetKey);
  await expect(page.getByTestId("dataset-select")).toHaveValue(datasetKey);
  if (templateName !== undefined) {
    const name = page.getByTestId("template-name");
    await name.fill(templateName);
    await name.press("Enter");
    await expect(name).toHaveValue(templateName);
  }
}

export const usageOf = (page: Page, column: string) =>
  page.getByLabel(`Användning för kolumnen ${column}`, { exact: true });
export const typeOf = (page: Page, column: string) =>
  page.getByLabel(`Typ för kolumnen ${column}`, { exact: true });
export const metricOf = (page: Page, column: string) =>
  page.getByLabel(`Mått för kolumnen ${column}`, { exact: true });
export const groupingOf = (page: Page, column: string) =>
  page.getByLabel(`Gruppera på för kolumnen ${column}`, { exact: true });

export async function ignoreColumns(page: Page, columns: string[]) {
  for (const column of columns) await usageOf(page, column).selectOption("ignore");
}

export async function groupBy(page: Page, column: string, dimension: string) {
  await usageOf(page, column).selectOption("dimension");
  await groupingOf(page, column).selectOption(dimension);
}

export async function measure(page: Page, column: string, metricKey: string, type?: string) {
  await usageOf(page, column).selectOption("measure");
  await metricOf(page, column).selectOption(metricKey);
  if (type) await typeOf(page, column).selectOption(type);
}

/** Opens a tool, fills its dialog and waits for the new step in the list. */
export async function addTool(page: Page, kind: string, fill: (dialog: Locator) => Promise<void>) {
  const steps = page.getByTestId("step-list").getByRole("listitem");
  const before = await steps.count();
  await page.getByTestId(`tool-${kind}`).click();
  const dialog = page.getByTestId("tool-dialog");
  await expect(dialog).toBeVisible();
  await fill(dialog);
  await dialog.getByTestId("tool-dialog-submit").click();
  await expect(dialog).toBeHidden();
  await expect(steps).toHaveCount(before + 1);
}

/** filter: removes the rows where the column equals (or contains) the value. */
export function filterRows(
  page: Page,
  column: string,
  operator: "equals" | "contains" | "empty",
  value?: string,
) {
  return addTool(page, "filter", async (d) => {
    await d.getByTestId("tool-column").selectOption(column);
    await d.getByLabel("Villkor").selectOption(operator);
    if (value !== undefined) await d.getByTestId("tool-value").fill(value);
  });
}

export function cleanColumn(page: Page, column: string, as: "amount" | "hours" | "number") {
  return addTool(page, "clean", async (d) => {
    await d.getByTestId("tool-column").selectOption(column);
    await d.getByLabel("Vad står i kolumnen?").selectOption(as);
  });
}

export function replaceText(
  page: Page,
  column: string,
  find: string,
  replace: string,
  match: "whole_cell" | "contains",
) {
  return addTool(page, "replace", async (d) => {
    await d.getByTestId("tool-column").selectOption(column);
    await d.getByTestId("tool-find").fill(find);
    await d.getByTestId("tool-replace").fill(replace);
    await d.getByLabel("Var?", { exact: true }).selectOption(match);
  });
}

/** Intelliplan's test customer: every intended mapping filters it out (fixtures/README.md). */
export const PRESENTATION_CUSTOMER = "Miljonbemanning Presentation (Stockholm)";

/** The Postnord customer record is the same customer as PostNord AB (fixtures/README.md). */
export const replacePostnord = (page: Page) =>
  replaceText(page, "kund", "Postnord", "PostNord AB", "whole_cell");

export async function saveTemplate(page: Page) {
  await page.getByTestId("save-template-button").click();
  await expect(page.getByTestId("mapping-view")).toBeHidden(SLOW);
}

/** Sets the export date of a cases file on its queue card; the file is read again. */
export async function setExportDate(page: Page, fileName: string, date: string) {
  const card = queueCard(page, fileName);
  await card.getByTestId("choice-asof").fill(date);
  await expect(card.getByTestId("choice-asof")).toHaveValue(date);
}
