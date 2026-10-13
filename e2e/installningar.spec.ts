// Inställningar: every section renders with the seeded catalog, and a few harmless round trips
// work and put everything back (a rename, an alias, the review threshold, a closed month).
// Settings apply to everyone at once, so the round trips run once (laptop) and restore the
// original through the service role even when a step fails.
import type { Page } from "@playwright/test";
import { deleteAlias, updateDimensionValue } from "@/lib/db/repo/catalog";
import { reopenPeriod, setDeviationThresholdPct, SETTING_DEFAULTS } from "@/lib/db/repo/settings";
import { SETTINGS_SECTIONS } from "@/lib/settings-ui/sections";
import { expect, test } from "./fixtures";
import { createE2eAdminClient } from "./helpers/admin";
import { dimensionValueId } from "./helpers/catalog";
import { resolveLocalSupabase } from "./helpers/local-supabase";

const admin = () => createE2eAdminClient(resolveLocalSupabase());

const toast = (page: Page, text: string) =>
  expect(page.locator("[data-sonner-toast]").filter({ hasText: text })).toBeVisible();

/** What each section shows once its data has loaded. */
const LOADED: Record<string, (page: Page) => Promise<void>> = {
  matt: (page) => expect(page.getByTestId("metric-row-timmar")).toContainText("Fakturerade timmar"),
  dimensioner: (page) =>
    expect(page.getByTestId("dimension-link-konsult")).toContainText("Personuppgift"),
  kontogrupper: (page) => expect(page.getByTestId("account-group-intakter")).toBeVisible(),
  importmallar: (page) => expect(page.getByTestId("template-row").first()).toBeVisible(),
  bolag: (page) => expect(page.getByTestId("company-MBR")).toContainText("Org.nr:"),
  perioder: (page) => expect(page.getByTestId("period-2026-09")).toBeVisible(),
  granskning: (page) => expect(page.getByTestId("review-threshold")).toBeVisible(),
  sakerhet: (page) => expect(page.getByTestId("password-form")).toBeVisible(),
};

test("every settings section renders from the overview and the sub-navigation", async ({
  page,
}) => {
  await page.goto("/installningar");
  const overview = page.getByTestId("settings-overview");
  await expect(overview.getByRole("link")).toHaveCount(SETTINGS_SECTIONS.length);

  for (const section of SETTINGS_SECTIONS) {
    const loaded = LOADED[section.slug];
    if (!loaded) throw new Error(`No check for the settings section ${section.slug}`);
    await page.getByTestId(`settings-nav-${section.slug}`).click();
    await expect(page).toHaveURL(new RegExp(`${section.href}$`));
    await expect(page.getByTestId(`settings-nav-${section.slug}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await loaded(page);
  }

  await page.goto("/installningar/dimensioner/verksamhet");
  await expect(page.getByTestId("dimension-values").getByRole("listitem")).not.toHaveCount(0);
  await expect(page.getByTestId("settings-nav-dimensioner")).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test.describe("round trips @once", () => {
  test("rename a value and back", async ({ page }) => {
    const label = "KVL";
    const id = await dimensionValueId("verksamhet", label);
    const row = page.getByTestId(`value-row-${id}`);
    const rename = async (to: string) => {
      await row.getByTestId("value-rename").click();
      await row.getByTestId("value-label-input").fill(to);
      await row.getByTestId("value-label-save").click();
      await toast(page, `Namnet är ändrat till ”${to}”.`);
      await expect(row.getByText(to, { exact: true })).toBeVisible();
    };
    try {
      await page.goto("/installningar/dimensioner/verksamhet");
      await rename(`${label} (e2e)`);
      await rename(label);
    } finally {
      await updateDimensionValue(admin(), id, { label });
    }
  });

  test("add an alias and remove it", async ({ page }) => {
    const alias = "e2e alias budbee";
    const id = await dimensionValueId("kund", "Budbee Södertälje");
    const row = page.getByTestId(`value-row-${id}`);
    try {
      await page.goto("/installningar/dimensioner/kund");
      await row.getByTestId("value-alias-add").click();
      await row.getByTestId("value-alias-input").fill(alias);
      await row.getByTestId("value-alias-save").click();
      await toast(page, "Aliaset är tillagt.");
      await expect(row.getByTestId("value-alias").filter({ hasText: alias })).toBeVisible();

      await row.getByRole("button", { name: `Ta bort aliaset ${alias}` }).click();
      await toast(page, `Aliaset ”${alias}” är borttaget.`);
      await expect(row.getByTestId("value-alias").filter({ hasText: alias })).toHaveCount(0);
    } finally {
      await deleteAlias(admin(), "kund", alias);
    }
  });

  test("change the review threshold and reset it", async ({ page }) => {
    const threshold = page.getByTestId("review-threshold");
    try {
      await page.goto("/installningar/granskning");
      await expect(threshold).toHaveValue("25");
      await threshold.fill("30");
      await page.getByTestId("review-save").click();
      await toast(page, "Avvikelsegränsen är 30 %.");
      await page.reload();
      await expect(threshold).toHaveValue("30");

      await page.getByRole("button", { name: "Återställ till 25 %" }).click();
      await page.getByTestId("review-save").click();
      await toast(page, "Avvikelsegränsen är 25 %.");
      await page.reload();
      await expect(threshold).toHaveValue("25");
    } finally {
      await setDeviationThresholdPct(admin(), SETTING_DEFAULTS.deviationThresholdPct);
    }
  });

  test("close a month and open it again", async ({ page }) => {
    const row = page.getByTestId("period-2026-09");
    try {
      await page.goto("/installningar/perioder");
      await row.getByRole("button", { name: "Stäng september 2026 för MB AB" }).click();
      await toast(page, "September 2026 för MB AB är stängd.");
      await expect(row).toContainText("Stängd");

      await row.getByRole("button", { name: "Öppna september 2026 för MB AB" }).click();
      await toast(page, "September 2026 för MB AB är öppnad igen.");
      await expect(
        row.getByRole("button", { name: "Stäng september 2026 för MB AB" }),
      ).toBeVisible();
    } finally {
      await reopenPeriod(admin(), "MBAB", "2026-09");
    }
  });
});
