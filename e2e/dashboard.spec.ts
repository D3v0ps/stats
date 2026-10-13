// Översikt with the data the seed project published (timmar for MB AB, SIE for both
// companies), then a drill from a KPI card into Utforska. Read-only.
import { expect, test } from "./fixtures";
import {
  kpiText,
  ledgerGroupTotal,
  reviewText,
  total,
  totalsBy,
  truthFacts,
} from "./helpers/truth";

// The default month follows the server clock, so the month is always given.
const MONTH = "2026-09";
const TIMMAR = truthFacts("intelliplan_timmar_MBAB_2026-09.xlsx");
const SIE = ["mbab_2026_psaldo.se", "mbr_2026_trans_only.se"];
const sumOfCompanies = (group: string) =>
  SIE.reduce((sum, file) => sum + ledgerGroupTotal(file, group, MONTH), 0);

test("KPI cards show the published September numbers", async ({ page }) => {
  await page.goto(`/?manad=${MONTH}`);
  await expect(page.getByRole("heading", { level: 1, name: "Översikt" })).toBeVisible();
  await expect(page.getByTestId("filter-month")).toContainText("September 2026");

  await expect(page.getByTestId("widget-timmar")).toContainText(
    kpiText("timmar", total(TIMMAR, "timmar")),
  );
  const consultants = new Set(TIMMAR.map((f) => f.dims.konsult)).size;
  await expect(page.getByTestId("widget-konsulter")).toContainText(
    kpiText("konsulter", consultants),
  );
  await expect(page.getByTestId("widget-resultat")).toContainText(
    kpiText("resultat", sumOfCompanies("resultat")),
  );
  await expect(page.getByTestId("widget-intakter")).toContainText(
    kpiText("intakter", sumOfCompanies("intakter")),
  );
  // No participant list was published.
  await expect(page.getByTestId("widget-aktiva-deltagare")).toContainText("Saknas");
});

test("a KPI card drills into Utforska and down to customers", async ({ page }) => {
  await page.goto(`/?manad=${MONTH}`);
  await page.getByRole("link", { name: "Fakturerade timmar: utforska" }).click();

  await expect(page).toHaveURL(/\/utforska\?/);
  const params = () => new URL(page.url()).searchParams;
  expect(params().get("matt")).toBe("timmar");
  expect(params().get("grupp")).toBe("bolag");
  expect(params().get("manad")).toBe(MONTH);
  await expect(page.getByTestId("metric-chip-timmar")).toBeVisible();
  await expect(page.getByTestId("drill-crumb-0")).toHaveText("Summa bolag");

  const pivot = page.getByTestId("pivot");
  const hours = reviewText("timmar", total(TIMMAR, "timmar"));
  await expect(pivot.getByTestId("pivot-row").filter({ hasText: "MB AB" })).toContainText(hours);

  await pivot.getByRole("link", { name: "MB AB", exact: true }).click();
  await expect.poll(() => params().get("grupp")).toBe("verksamhet");
  expect(params().get("bolag")).toBe("MBAB");
  await expect(page.getByTestId("drill-crumb-1")).toHaveText("MB AB");

  await pivot.getByRole("link", { name: "Bemanning", exact: true }).click();
  await expect.poll(() => params().get("grupp")).toBe("kund");
  await expect(page.getByTestId("drill-crumb-2")).toHaveText("Bemanning");
  const perCustomer = totalsBy(TIMMAR, "timmar", "kund");
  await expect(pivot.getByTestId("pivot-row")).toHaveCount(perCustomer.size);
  for (const [customer, value] of perCustomer) {
    await expect(pivot.getByTestId("pivot-row").filter({ hasText: customer })).toContainText(
      reviewText("timmar", value),
    );
  }
});
