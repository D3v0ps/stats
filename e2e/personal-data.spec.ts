// Personal data never reaches a board report: no consultant or participant name from the
// fixtures, no personnummer and no konsult value (an anställnings-id) in the live presentation,
// its notes, the frozen report and its stored snapshot, presentation, notes and print view, and
// the slide form never offers konsult. Once (laptop): it freezes a report, which can never be
// deleted.
import type { Page } from "@playwright/test";
import { ReportTemplateSpecSchema } from "@/lib/contracts/slides";
import { containsPersonnummer } from "@/lib/core/pnr";
import { expect, test } from "./fixtures";
import { dimensionValues } from "./helpers/catalog";
import {
  REPORT_MONTH,
  freezeThroughUi,
  frozenSnapshot,
  insertReportTemplate,
  removeReportTemplate,
  slideName,
} from "./helpers/reports";
import { fixturePersonNames } from "./helpers/truth";

const NAMES = fixturePersonNames();

const slide = (id: string, viz: string, metricKey: string, groupBy: string | null) => ({
  id,
  viz,
  metricKey,
  groupBy,
  grain: "month",
  company: metricKey === "aktiva_deltagare" ? "ALL" : "MBAB",
});

// Every breakdown a board report can show, on the datasets that also carry konsult.
const SPEC = ReportTemplateSpecSchema.parse({
  name: `E2E personuppgifter ${Date.now()}`,
  slides: [
    slide("uppdrag", "table", "timmar", "uppdrag"),
    slide("kund", "toplist", "timmar", "kund"),
    slide("kund-donut", "donut", "pass", "kund"),
    slide("sjuk", "table", "sjuktimmar", "kund"),
    slide("fakturerat", "bar", "fakturerat_ip", "kund"),
    slide("konsulter", "kpi", "konsulter", null),
    slide("verksamhet", "bar", "aktiva_deltagare", "verksamhet"),
  ],
});
const SLIDES = SPEC.slides.length;

interface Konsult {
  ids: Set<number>;
  labels: Set<string>;
}

/**
 * The text a page gives away: what it shows (visually hidden chart tables included) and the
 * data its scripts carry. Not the raw HTML: chart coordinates such as 243.414634146341 hold
 * digit runs that can pass the personnummer checks by chance.
 */
async function pageText(page: Page): Promise<string> {
  const shown = await page.locator("body").innerText();
  const scripts = await page.locator("script").allTextContents();
  return [shown, ...scripts].join("\n");
}

async function expectNoPersonalData(page: Page, where: string, konsult: Konsult) {
  // Names cannot match by chance, so they are looked for in attributes too.
  const html = await page.content();
  expect(
    NAMES.filter((name) => html.includes(name)),
    `${where}: names from the fixtures`,
  ).toEqual([]);
  expect(containsPersonnummer(await pageText(page)), `${where}: a personnummer`).toBe(false);
  // Groups are row headers: in slide tables and in the visually hidden table of every chart.
  const rowHeaders = await page.locator('th[scope="row"]').allTextContents();
  expect(
    rowHeaders.map((t) => t.trim()).filter((t) => konsult.labels.has(t)),
    `${where}: konsult values as row headers`,
  ).toEqual([]);
  await expect(page.locator("th").filter({ hasText: /^Konsult$/ })).toHaveCount(0);
}

/** Every slide of a deck, one at a time. */
async function expectDeckClean(page: Page, where: string, konsult: Konsult) {
  for (let n = 1; n <= SLIDES; n++) {
    await expect(page.getByRole("region", { name: slideName(n, SLIDES) })).toBeVisible();
    await expectNoPersonalData(page, `${where}, bild ${n}`, konsult);
    if (n < SLIDES) await page.keyboard.press("ArrowRight");
  }
}

/** The groups a frozen snapshot stores: chart categories and table rows, labels and ids. */
function snapshotGroups(json: string) {
  const snapshot = JSON.parse(json) as {
    slides: {
      chart: { categories: string[]; categoryIds?: (number | string | null)[] } | null;
      table: { rows: { label: string; id?: number | string | null }[] } | null;
    }[];
  };
  const labels: string[] = [];
  const ids: (number | string | null | undefined)[] = [];
  for (const slide of snapshot.slides) {
    labels.push(
      ...(slide.chart?.categories ?? []),
      ...(slide.table?.rows ?? []).map((r) => r.label),
    );
    ids.push(...(slide.chart?.categoryIds ?? []), ...(slide.table?.rows ?? []).map((r) => r.id));
  }
  return { labels, ids };
}

test("no names, personnummer or konsult values in reports @once", async ({ page }) => {
  const values = await dimensionValues("konsult");
  // The seed published consultants, so a leak would have something to show.
  expect(values.length).toBeGreaterThan(0);
  expect(NAMES.length).toBeGreaterThan(0);
  const konsult: Konsult = {
    ids: new Set(values.map((v) => v.id)),
    labels: new Set(values.map((v) => v.label)),
  };

  const templateId = await insertReportTemplate(SPEC);
  try {
    await test.step("the slide form never offers konsult", async () => {
      await page.goto(`/rapporter/${templateId}`);
      await expect(page.getByTestId("slide-item")).toHaveCount(SLIDES);
      await page.getByTestId("field-group").click();
      const options = page.getByRole("option");
      await expect(options.filter({ hasText: "Uppdrag" })).toHaveCount(1);
      expect(await options.allTextContents()).not.toContain("Konsult");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("filter-kund")).toHaveCount(1);
      await expect(page.getByTestId("filter-konsult")).toHaveCount(0);
    });

    await test.step("the live presentation and its notes", async () => {
      await page.goto(`/presentera/${templateId}?manad=${REPORT_MONTH}`);
      await expectDeckClean(page, "presentation", konsult);
      await page.goto(`/presentera/${templateId}/manus?manad=${REPORT_MONTH}`);
      await expect(page.getByTestId("notes-window")).toBeVisible();
      await expectNoPersonalData(page, "talarmanus", konsult);
    });

    const frozenId = await freezeThroughUi(page, templateId, `E2E personuppgifter ${Date.now()}`);

    await test.step("the frozen snapshot stores no name, personnummer or konsult group", async () => {
      const snapshot = await frozenSnapshot(frozenId);
      expect(NAMES.filter((name) => snapshot.includes(name))).toEqual([]);
      expect(containsPersonnummer(snapshot)).toBe(false);
      const { labels, ids } = snapshotGroups(snapshot);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.filter((l) => konsult.labels.has(l))).toEqual([]);
      expect(ids.filter((id) => typeof id === "number" && konsult.ids.has(id))).toEqual([]);
    });

    await test.step("the frozen report, its presentation, notes and print view", async () => {
      await expect(page.getByTestId("archive-lock")).toBeVisible();
      await expectNoPersonalData(page, "arkiv", konsult);
      await page.goto(`/presentera/arkiv/${frozenId}`);
      await expectDeckClean(page, "fryst presentation", konsult);
      await page.goto(`/presentera/arkiv/${frozenId}/manus`);
      await expect(page.getByTestId("notes-window")).toBeVisible();
      await expectNoPersonalData(page, "fryst talarmanus", konsult);
      await page.goto(`/presentera/arkiv/${frozenId}/utskrift`);
      await expect(page.getByTestId("print-page")).toHaveCount(SLIDES);
      await expectNoPersonalData(page, "utskrift", konsult);
    });
  } finally {
    await removeReportTemplate(templateId);
  }
});
