// A board report from start to archive: create it from the standard template, edit a headline
// and the speaker notes, present it with the keyboard and the notes window, freeze it and open
// the frozen version and its print view. Once (laptop): it creates a template, deleted at the
// end, and a frozen report, which can never be deleted (so its title is unique).
import type { Page } from "@playwright/test";
import { formatNumber } from "@/lib/core/format-sv";
import { DEFAULT_REPORT_NAME, defaultReportSpec } from "@/lib/present/default-report";
import { expect, test } from "./fixtures";
import {
  REPORT_MONTH,
  STANDARD_SLIDES,
  freezeThroughUi,
  insertReportTemplate,
  removeReportTemplate,
  reportTemplateCount,
  slideName,
} from "./helpers/reports";
import { checkView } from "./helpers/visual";

const HEADLINE = "E2E: resultatet mot budget";
const NOTES = "E2E-manus: säg något om budgeten här.";

/** Space and Enter on a focused button press the button, not the deck. */
const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function expectSlide(page: Page, n: number) {
  await expect(page.getByTestId("deck-counter")).toHaveText(
    `${formatNumber(n)} / ${formatNumber(STANDARD_SLIDES)}`,
  );
  await expect(page.getByRole("region", { name: slideName(n) })).toBeVisible();
  if (n === 1) await expect.poll(() => new URL(page.url()).searchParams.get("bild")).toBeNull();
  else await expect.poll(() => new URL(page.url()).searchParams.get("bild")).toBe(String(n));
}

/**
 * "Skapa standardrapport" is only offered while there is no template; otherwise the spec makes
 * its own copy of the standard report through the service role.
 */
async function standardTemplate(page: Page): Promise<string> {
  if ((await reportTemplateCount()) > 0) {
    return insertReportTemplate(defaultReportSpec(`E2E rapport ${Date.now()}`));
  }
  await page.goto("/rapporter");
  await page.getByTestId("create-default-report").click();
  const card = page.getByTestId("template-card").filter({ hasText: DEFAULT_REPORT_NAME });
  await expect(card).toContainText(`${formatNumber(STANDARD_SLIDES)} bilder`);
  const href = await card.getByTestId("edit-link").getAttribute("href");
  const id = href?.split("/").pop();
  if (!id) throw new Error("The new template's editor link is missing.");
  return id;
}

test("create, edit, present, freeze and print a board report @once", async ({ page }) => {
  const templateId = await standardTemplate(page);
  try {
    await test.step("edit the second slide's headline and notes", async () => {
      await page.goto(`/rapporter/${templateId}`);
      await expect(page.getByTestId("slide-item")).toHaveCount(9);
      await page.getByTestId("slide-select").nth(1).click();
      await page.getByTestId("field-headline").fill(HEADLINE);
      await page.getByTestId("field-notes").fill(NOTES);
      await page.getByTestId("editor-save").click();
      await expect(page.getByText("Sparat.", { exact: true })).toBeVisible();
      await expect(page.getByTestId("editor-save")).toHaveText("Sparat");
      await checkView(page, "rapport-redigerad");
    });

    await test.step("present with the keyboard", async () => {
      await page.getByTestId("editor-present").click();
      await page.waitForURL(`**/presentera/${templateId}`);
      await expectSlide(page, 1);
      await expect(page.getByTestId("deck-prev")).toBeDisabled();

      await page.keyboard.press("ArrowRight");
      await expectSlide(page, 2);
      // Slides show headlines in capitals.
      await expect(page.getByRole("region", { name: slideName(2) })).toContainText(HEADLINE, {
        ignoreCase: true,
      });
      await page.keyboard.press("PageDown");
      await expectSlide(page, 3);
      await blur(page);
      await page.keyboard.press("Space");
      await expectSlide(page, 4);
      await page.keyboard.press("Shift+Space");
      await expectSlide(page, 3);
      await page.keyboard.press("ArrowLeft");
      await expectSlide(page, 2);
      await page.keyboard.press("End");
      await expectSlide(page, 9);
      await expect(page.getByTestId("deck-next")).toBeDisabled();
      await page.keyboard.press("Home");
      await expectSlide(page, 1);
      // The deck never receives the speaker notes.
      expect(await page.content()).not.toContain(NOTES);
    });

    await test.step("the notes window follows the deck", async () => {
      await page.keyboard.press("ArrowRight");
      await expectSlide(page, 2);
      const [notes] = await Promise.all([
        page.waitForEvent("popup"),
        page.getByTestId("open-notes").click(),
      ]);
      await expect(notes).toHaveURL(new RegExp(`/presentera/${templateId}/manus`));
      await expect(notes.getByRole("heading", { level: 1, name: "Talarmanus" })).toBeVisible();
      await expect(notes.getByText(slideName(2), { exact: true })).toBeVisible();
      await expect(notes.getByTestId("notes-text")).toHaveText(NOTES);
      await checkView(notes, "rapport-manus");

      await blur(page);
      await page.keyboard.press("ArrowRight");
      await expectSlide(page, 3);
      await expect(notes.getByText(slideName(3), { exact: true })).toBeVisible();

      await notes.getByRole("button", { name: "Nästa bild" }).click();
      await expect(notes.getByText(slideName(4), { exact: true })).toBeVisible();
      await expectSlide(page, 4);
      await notes.close();
    });

    const title = `E2E rapport ${Date.now()}`;
    const frozenId = await test.step("freeze it with a unique title", async () => {
      const id = await freezeThroughUi(page, templateId, title, REPORT_MONTH);
      await expect(page.getByTestId("archive-lock")).toContainText("Låst version från");
      const slides = page.getByRole("list", { name: "Bilder" }).getByRole("listitem");
      await expect(slides).toHaveCount(9);
      await expect(
        page.getByRole("link", {
          name: new RegExp(`^Presentera från bild ${formatNumber(2)}: ${HEADLINE}`, "i"),
        }),
      ).toBeVisible();
      return id;
    });

    await test.step("open the frozen presentation and its print view", async () => {
      await page.getByTestId("present-link").click();
      await page.waitForURL(`**/presentera/arkiv/${frozenId}`);
      await expectSlide(page, 1);
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("region", { name: slideName(2) })).toContainText(HEADLINE, {
        ignoreCase: true,
      });
      await page.getByTestId("deck-exit").click();
      await page.waitForURL(`**/rapporter/arkiv/${frozenId}`);

      await page.getByTestId("print-link").click();
      await page.waitForURL(`**/presentera/arkiv/${frozenId}/utskrift`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByTestId("print-page")).toHaveCount(9);
      await page.evaluate(() => {
        (window as unknown as { printed: number }).printed = 0;
        window.print = () => {
          (window as unknown as { printed: number }).printed += 1;
        };
      });
      await page.getByTestId("print-button").click();
      expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
      // On paper only the slides remain.
      await page.emulateMedia({ media: "print" });
      await expect(page.getByTestId("print-button")).toBeHidden();
      await expect(page.getByTestId("print-page").first()).toBeVisible();
    });

    await test.step("delete the template; the frozen report stays", async () => {
      await page.emulateMedia({ media: "screen" });
      await page.goto(`/rapporter/${templateId}`);
      await page.getByTestId("editor-delete").click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Ta bort" }).click();
      await page.waitForURL(/\/rapporter$/);
      await expect(page.getByTestId("frozen-item").filter({ hasText: title })).toBeVisible();
    });
  } finally {
    // A no-op once the last step deleted it.
    await removeReportTemplate(templateId);
  }
});
