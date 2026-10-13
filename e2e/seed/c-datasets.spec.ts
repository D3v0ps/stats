// Spec C: every other dataset through the upload page, on top of the timmar (A, B) and SIE (D)
// data. Each file is mapped by hand the way fixtures/README.md describes, its review is checked
// against the fixture truth and it is published. The tests build on each other's catalog
// values and templates, so they run in order and a failure skips the rest.
import type { Locator, Page } from "@playwright/test";
import { formatNumber } from "@/lib/core/format-sv";
import { formatMonthShort } from "@/lib/core/month";
import { formatMonthSpan } from "@/lib/import-ui/months";
import { expect, test } from "../fixtures";
import {
  PRESENTATION_CUSTOMER,
  addTool,
  chooseDataset,
  cleanColumn,
  filterRows,
  groupBy,
  ignoreColumns,
  measure,
  metricOf,
  openMapping,
  replacePostnord,
  replaceText,
  saveTemplate,
  setExportDate,
  usageOf,
} from "../helpers/mapping";
import {
  fixtureFile,
  metricName,
  reviewText,
  total,
  truthFacts,
  type TruthFact,
} from "../helpers/truth";
import {
  SLOW,
  addFiles,
  comparisonRow,
  expectPhase,
  expectReviewValue,
  expectStatus,
  openUploadPage,
  publish,
  queueCard,
  removeFromQueue,
  reviewPanel,
} from "../helpers/upload";

test.describe.configure({ mode: "serial" });

const FORTNOX = "fortnox_kundforsaljning_MBAB_2026.xlsx";
const FAKTURERING = "intelliplan_fakturering_MBAB_2026-09.xlsx";
const FRANVARO = "intelliplan_franvaro_MBAB_2026-09.csv";
const KONSULTER = "intelliplan_konsulter_MBAB.xlsx";
const KUNDLISTA = "intelliplan_kundlista.xls";
const DELTAGARE_MBAB = "workbuster_deltagare_MBAB.xlsx";
const DELTAGARE_MBR = "workbuster_deltagare_MBR.xlsx";
const ORDRAR = "workbuster_ordrar_MBAB.xlsx";
const BUDGET = "budget_2026.xlsx";
/** Spec A's template, which the frånvaro file resembles. */
const TIMMAR_TEMPLATE = "Intelliplan – timmar och pass";

// The truth of the cases files ends with the last complete month (fixtures/README.md).
const CASES_EXPORT_DATE = "2026-09-30";
const SEP = "2026-09";

const monthsOf = (facts: readonly TruthFact[]) => [...new Set(facts.map((f) => f.month))].sort();
const published = (metrics: number, months: string[], company: string) =>
  `Publicerat: ${formatNumber(metrics)} mått, ${formatMonthSpan(months)}, ${company}.`;

/**
 * A cases file is read as soon as its template is saved, up to the export date the file states
 * (in October, a month that has not ended). The export date is moved to the end of September on
 * the queue card, which reads the file again.
 */
async function readCasesFile(page: Page, fileName: string): Promise<Locator> {
  const panel = reviewPanel(page, fileName);
  await expectPhase(panel, "ready");
  await expect(panel.getByTestId("include-open-months")).toHaveCount(1);
  await page.getByTestId("back-button").click();

  const card = queueCard(page, fileName);
  await expectStatus(card, "ready");
  await setExportDate(page, fileName, CASES_EXPORT_DATE);
  await expectStatus(card, "ready");
  await card.getByTestId("review-button").click();
  await expectPhase(panel, "ready");
  await expect(panel.getByTestId("include-open-months")).toHaveCount(0);
  return panel;
}

test("Fortnox kundförsäljning: mapped by hand, one new customer", async ({ page }) => {
  const facts = truthFacts(FORTNOX);
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(FORTNOX)]);
  const card = queueCard(page, FORTNOX);
  await expectStatus(card, "new");
  await openMapping(page, card);

  await chooseDataset(page, "fx_kundforsaljning");
  await expect(metricOf(page, "belopp exkl. moms")).toHaveValue("fakturerat_kund");
  await expect(usageOf(page, "fakturadatum")).toHaveValue("period");
  // Every amount column and the customer number are suggested too; only the amount before VAT
  // and the customer name are wanted.
  await ignoreColumns(page, ["kundnr", "moms", "totalt"]);
  await filterRows(page, "fakturanr", "equals", "summa");
  await replacePostnord(page);
  await page.getByTestId("company-mbab").check();
  await saveTemplate(page);

  // Arbetsförmedlingen is the one customer the timmar files did not bring.
  const panel = reviewPanel(page, FORTNOX);
  await expectPhase(panel, "values");
  const unknown = panel.getByTestId("unknown-values");
  await expect(unknown).toContainText(`Kund (${formatNumber(1)} nya)`);
  await unknown
    .getByRole("listitem")
    .filter({ hasText: "Arbetsförmedlingen" })
    .getByTestId("add-new-value")
    .click();
  await expectPhase(panel, "ready");

  const months = monthsOf(facts);
  await expect(panel).toContainText(
    `Fortnox – försäljning per kund · ${formatMonthSpan(months)} · MB AB`,
  );
  for (const month of months) {
    await expectReviewValue(
      panel,
      "fakturerat_kund",
      month,
      total(facts, "fakturerat_kund", month),
    );
  }
  await publish(panel, published(1, months, "MB AB"));
});

test("Intelliplan fakturering: grouped report, month per upload", async ({ page }) => {
  const billing = truthFacts(FAKTURERING);
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(FAKTURERING)]);
  const card = queueCard(page, FAKTURERING);
  // Order matters: this runs before the frånvaro test saves its template. Four of the eight
  // columns the two reports have between them are shared, exactly the drift limit, so after it
  // this file would open as a changed frånvaro report instead of a new one.
  await expectStatus(card, "new");
  await openMapping(page, card);

  await chooseDataset(page, "ip_fakturering");
  await expect(page.getByTestId("removed-row").filter({ hasText: "Konsult" })).toContainText(
    "Personuppgift",
  );
  // The hours are in the time report already.
  await ignoreColumns(page, ["timmar"]);
  await filterRows(page, "kund", "contains", "summa");
  await filterRows(page, "kund", "equals", "totalt");
  await addTool(page, "fill_down", async (d) => {
    await d.getByTestId("tool-column").selectOption("kund");
  });
  // After the fill-down, or the presentation customer's second line survives.
  await filterRows(page, "kund", "equals", PRESENTATION_CUSTOMER);
  await cleanColumn(page, "fakturerat belopp", "amount");
  await cleanColumn(page, "lönekostnad", "amount");
  await replacePostnord(page);
  await expect(page.getByTestId("period-per-upload")).toBeChecked();
  await page.getByTestId("company-mbab").check();
  await saveTemplate(page);

  // The month is taken from the file name and the report's Period line.
  const panel = reviewPanel(page, FAKTURERING);
  await expectPhase(panel, "ready");
  await expect(panel).toContainText(
    `Intelliplan – fakturerat och lön · ${formatMonthShort(SEP)} · MB AB`,
  );
  await expectReviewValue(panel, "fakturerat_ip", SEP, total(billing, "fakturerat_ip"));
  await expectReviewValue(panel, "lonekostnad", SEP, total(billing, "lonekostnad"));
  await publish(panel, published(2, [SEP], "MB AB"));
});

test("Intelliplan frånvaro: a changed timmar report mapped as a new report type", async ({
  page,
}) => {
  const facts = truthFacts(FRANVARO);
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(FRANVARO)]);
  const card = queueCard(page, FRANVARO);
  // The absence report shares five of its six columns with the time report.
  await expectStatus(card, "drift");
  await card.getByTestId("drift-button").click();
  const drift = page.getByTestId("drift-view");
  await expect(drift).toContainText(`liknar rapporten ”${TIMMAR_TEMPLATE}”`);
  await drift.getByTestId("map-as-new-button").click();

  // A report type of its own, not an update of the timmar template: the dataset is chosen
  // afresh, and the review below names the new template.
  await expect(page.getByRole("heading", { level: 2, name: "Mappa rapporten" })).toBeVisible();
  await expect(page.getByTestId("mapping-view")).toBeVisible(SLOW);
  await expect(page.getByTestId("dataset-select")).toBeEnabled();
  await expect(page.getByTestId("dataset-select")).toHaveValue("");
  await chooseDataset(page, "ip_franvaro");
  await expect(page.getByTestId("template-name")).toHaveValue("Intelliplan – frånvaro");
  await expect(page.getByTestId("removed-row").filter({ hasText: "Konsult" })).toContainText(
    "Personuppgift",
  );
  await expect(usageOf(page, "datum")).toHaveValue("period");
  await groupBy(page, "frånvaroorsak", "franvarotyp");
  await measure(page, "timmar", "sjuktimmar", "hours");
  // No catalog metric counts unauthorised absence.
  await filterRows(page, "frånvaroorsak", "equals", "Olovlig frånvaro");
  await cleanColumn(page, "timmar", "hours");
  await replacePostnord(page);
  await addTool(page, "counter", async (d) => {
    await d.getByTestId("tool-metric").selectOption("sjukpass");
  });
  await page.getByTestId("company-mbab").check();
  await saveTemplate(page);

  const panel = reviewPanel(page, FRANVARO);
  await expectPhase(panel, "ready");
  await expect(panel).toContainText(`Intelliplan – frånvaro · ${formatMonthShort(SEP)} · MB AB`);
  await expectReviewValue(panel, "sjuktimmar", SEP, total(facts, "sjuktimmar"));
  await expectReviewValue(panel, "sjukpass", SEP, total(facts, "sjukpass"));
  await publish(panel, published(2, [SEP], "MB AB"));
});

test("Intelliplan kundlista: an HTML table with entities reads as plain text", async ({ page }) => {
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(KUNDLISTA)]);
  const card = queueCard(page, KUNDLISTA);
  await expectStatus(card, "new");
  await openMapping(page, card);

  await expect(page.getByTestId("column-row")).toHaveCount(3);
  await expect(page.getByTestId("column-rows")).toContainText("Arbetsställe");
  const preview = page.getByTestId("preview-table");
  await expect(preview).toContainText("Budbee Södertälje");
  await expect(preview).not.toContainText(/&[#\w]+;/);

  // A customer list feeds the kund spellings; it is no report of its own to publish.
  await page.getByTestId("mapping-view").getByRole("button", { name: "Avbryt" }).click();
  await removeFromQueue(page, KUNDLISTA);
});

test("Intelliplan konsultlista: cases with an export date and a first month", async ({ page }) => {
  const facts = truthFacts(KONSULTER);
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(KONSULTER)]);
  const card = queueCard(page, KONSULTER);
  await expectStatus(card, "new");
  await openMapping(page, card);

  await chooseDataset(page, "ip_konsulter");
  await expect(page.getByTestId("case-case_key")).toHaveValue("anställnings id");
  await expect(page.getByTestId("case-case_start")).toHaveValue("startdatum");
  await expect(page.getByTestId("case-case_end")).toHaveValue("slutdatum");
  // "MBAB / Södertälje" → "Södertälje": the unit is the town.
  await replaceText(page, "organisationsenhet", "MBAB / ", "", "contains");
  await groupBy(page, "organisationsenhet", "ort");
  await page.getByLabel("Räkna från månad (valfritt)").selectOption("2023-01");
  await page.getByTestId("company-mbab").check();
  await saveTemplate(page);

  const panel = await readCasesFile(page, KONSULTER);
  const months = monthsOf(facts);
  await expect(panel).toContainText(
    `Intelliplan – konsultlista · ${formatMonthSpan(months)} · MB AB`,
  );
  for (const metric of ["anstallda_konsulter", "nyanstallda", "avslutade_anstallningar"]) {
    for (const month of [months[0]!, SEP]) {
      await expectReviewValue(panel, metric, month, total(facts, metric, month));
    }
  }
  await publish(panel, published(4, months, "MB AB"));
});

async function mapDeltagare(page: Page, fileName: string, company: "MB AB" | "MB Restart") {
  await openMapping(page, queueCard(page, fileName));
  await chooseDataset(page, "wb_deltagare", `Workbuster – deltagare ${company}`);
  await expect(page.getByTestId("case-case_key")).toHaveValue("gen-nummer");
  await expect(page.getByTestId("case-case_interrupt")).toHaveValue("avbrott");
  await expect(page.getByTestId("case-case_result")).toHaveValue("resultat");
  await expect(page.getByTestId("case-case_result_date")).toHaveValue("resultatdatum");
  await expect(page.getByText(/^Grupperas på:/)).toHaveText("Grupperas på: Tjänst, Ort.");
  await page.getByLabel("Räkna från månad (valfritt)").selectOption("2025-01");
  await page.getByTestId(company === "MB AB" ? "company-mbab" : "company-mbr").check();
  await saveTemplate(page);
}

async function reviewDeltagare(page: Page, fileName: string, company: "MB AB" | "MB Restart") {
  const facts = truthFacts(fileName);
  const panel = await readCasesFile(page, fileName);
  const months = monthsOf(facts);
  await expect(panel).toContainText(
    `Workbuster – deltagare ${company} · ${formatMonthSpan(months)} · ${company}`,
  );
  const metrics = [
    "aktiva_deltagare",
    "nya_deltagare",
    "avslutade_deltagare",
    "avbrott_deltagare",
    "resultat_deltagare",
  ];
  for (const metric of metrics) {
    await expectReviewValue(panel, metric, SEP, total(facts, metric, SEP), company);
  }
  await expectReviewValue(
    panel,
    "aktiva_deltagare",
    months[0]!,
    total(facts, "aktiva_deltagare", months[0]!),
    company,
  );
  await publish(panel, published(metrics.length, months, company));
  await page.getByTestId("back-button").click();
}

test("Workbuster deltagare MB AB: its own template; the MBR file dropped with it waits", async ({
  page,
}) => {
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(DELTAGARE_MBAB), fixtureFile(DELTAGARE_MBR)]);
  await expectStatus(queueCard(page, DELTAGARE_MBAB), "new");
  await expectStatus(queueCard(page, DELTAGARE_MBR), "new");

  await mapDeltagare(page, DELTAGARE_MBAB, "MB AB");
  await reviewDeltagare(page, DELTAGARE_MBAB, "MB AB");

  // The files have the same columns, but the MBR file names its own company: saving the MB AB
  // template did not read it. It is dropped again by itself in the next test.
  await expectStatus(queueCard(page, DELTAGARE_MBAB), "published");
  await expectStatus(queueCard(page, DELTAGARE_MBR), "new");
  await removeFromQueue(page, DELTAGARE_MBR);
});

test("Workbuster deltagare MB Restart: dropped alone, not read with the MB AB template", async ({
  page,
}) => {
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(DELTAGARE_MBR)]);
  // Only the MB AB template fits its columns, but the file names MB Restart.
  const card = queueCard(page, DELTAGARE_MBR);
  await expectStatus(card, "new");
  await expect(card.getByTestId("status-chip")).toHaveText("Ny rapporttyp – mappa");

  await mapDeltagare(page, DELTAGARE_MBR, "MB Restart");
  await reviewDeltagare(page, DELTAGARE_MBR, "MB Restart");
  await expectStatus(card, "published");

  // Each company keeps its own participants: the MBR file replaced nothing of MB AB's.
  const metrics = ["aktiva_deltagare", "nya_deltagare"];
  await page.goto(`/utforska?matt=${metrics.join(",")}&grupp=bolag&manad=${SEP}`);
  const pivot = page.getByTestId("pivot");
  const rows = pivot.getByTestId("pivot-row");
  await expect(rows.first()).toBeVisible();
  // The row's cells line up with the header cells: the group label first, then one per column.
  // Right-aligned headers start with their sort arrow, so a name is looked for anywhere in them.
  const headers = await pivot.locator("thead th").allTextContents();
  for (const [company, file] of [
    ["MB AB", DELTAGARE_MBAB],
    ["MB Restart", DELTAGARE_MBR],
  ] as const) {
    const facts = truthFacts(file);
    const row = rows.filter({ hasText: company });
    await expect(row).toHaveCount(1);
    for (const metric of metrics) {
      const column = headers.findIndex((h) => h.includes(metricName(metric)));
      expect(column, `${metricName(metric)} column`).toBeGreaterThan(0);
      // The value is the cell's first line; a delta badge may follow it.
      const value = row.locator("th, td").nth(column).locator("span > span").first();
      await expect(value).toHaveText(reviewText(metric, total(facts, metric, SEP)));
    }
  }
});

test("Workbuster ordrar: the Belopp column stays a measure", async ({ page }) => {
  const facts = truthFacts(ORDRAR);
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(ORDRAR)]);
  const card = queueCard(page, ORDRAR);
  await expectStatus(card, "new");
  await openMapping(page, card);

  await chooseDataset(page, "wb_ordrar");
  // Five-digit amounts once read as postal codes, which removed the column as personal data.
  await expect(page.getByRole("checkbox", { name: "Behåll kolumnen Belopp" })).toBeChecked();
  await expect(page.getByTestId("removed-row")).toHaveCount(0);
  await expect(metricOf(page, "belopp")).toHaveValue("af_intakt");
  await expect(usageOf(page, "datum")).toHaveValue("period");
  await filterRows(page, "ordernummer", "equals", "summa");
  await cleanColumn(page, "belopp", "amount");
  await page.getByTestId("company-mbab").check();
  await saveTemplate(page);

  const panel = reviewPanel(page, ORDRAR);
  await expectPhase(panel, "ready");
  const months = monthsOf(facts);
  for (const month of months) {
    await expectReviewValue(panel, "af_intakt", month, total(facts, "af_intakt", month));
  }
  await publish(panel, published(1, months, "MB AB"));
});

const budgetCard = (page: Page, sheet: string) =>
  queueCard(page, BUDGET).filter({ hasText: `blad ${sheet}` });

async function mapBudgetSheet(page: Page, sheet: "MB AB" | "MB Restart") {
  await openMapping(page, budgetCard(page, sheet));
  await expect(page.getByTestId("mapping-view")).toContainText(`blad ${sheet} ·`);
  await chooseDataset(page, "budget");
  await expect(page.getByTestId("template-name")).toHaveValue(`Budget – ${sheet}`);

  await groupBy(page, "post", "kontogrupp");
  // The sum rows and the full year are worked out from the rest.
  await filterRows(page, "post", "equals", "Rörelseresultat");
  await filterRows(page, "post", "equals", "Resultat efter finansiella poster");
  await page.getByRole("checkbox", { name: "Behåll kolumnen Helår" }).click();
  await addTool(page, "unpivot", async (d) => {
    // The month columns are picked already.
    for (const month of ["Jan", "Jun", "Dec"]) {
      await expect(d.getByRole("checkbox", { name: month, exact: true })).toBeChecked();
    }
    await d.getByTestId("tool-valueColumn").fill("belopp");
  });
  await addTool(page, "constant", async (d) => {
    await d.getByTestId("tool-column").fill("år");
    await d.getByTestId("tool-value").fill("2026");
  });
  // "jan" + "2026" → "jan 2026".
  await addTool(page, "merge", async (d) => {
    await d.getByRole("checkbox", { name: "månad", exact: true }).check();
    await d.getByRole("checkbox", { name: "år", exact: true }).check();
    await d.getByTestId("tool-into").fill("period");
  });
  await usageOf(page, "period").selectOption("period");
  await measure(page, "belopp", "budget_belopp", "amount");
  await page.getByTestId(sheet === "MB AB" ? "company-mbab" : "company-mbr").check();
  // Revenue positive and costs negative, as the sheet says.
  await expect(page.getByTestId("budget-sign-result")).toBeChecked();
  await saveTemplate(page);
}

async function reviewBudgetSheet(page: Page, sheet: "MB AB" | "MB Restart", flags: number) {
  const company = sheet === "MB AB" ? "MBAB" : "MBR";
  const facts = truthFacts(BUDGET).filter((f) => f.company === company);
  const panel = reviewPanel(page, BUDGET);
  await expectPhase(panel, "ready");

  // October to December have not ended by the pinned clock and are left out unless asked for.
  const months = monthsOf(facts);
  const open = months.filter((m) => m >= "2026-10");
  await expect(panel).toContainText(`Ta med ${formatMonthSpan(open)} som inte är slut ännu.`);
  await expect(comparisonRow(panel, "budget_belopp", "2026-12", sheet)).toHaveCount(0);
  await panel.getByTestId("include-open-months").check();
  // Ticking restages the whole file: wait for the new comparison, not the old "ready".
  await expect(comparisonRow(panel, "budget_belopp", "2026-12", sheet)).toHaveCount(1, {
    timeout: 90_000,
  });
  await expectPhase(panel, "ready");

  await expect(panel).toContainText(`Budget – ${sheet} · ${formatMonthSpan(months)} · ${sheet}`);
  await expect(panel.getByTestId("comparison-table").locator("tr[data-flagged]")).toHaveCount(
    flags,
  );
  await expect(panel).toContainText(
    `${formatNumber(flags)} värden avviker mer än ${formatNumber(25)} % mot föregående månad.`,
  );
  for (const month of months) {
    await expectReviewValue(
      panel,
      "budget_belopp",
      month,
      total(facts, "budget_belopp", month),
      sheet,
    );
  }
  await publish(panel, published(1, months, sheet));
  await page.getByTestId("back-button").click();
}

test("Budget: one template per sheet, open months included", async ({ page }) => {
  await openUploadPage(page);
  await addFiles(page, [fixtureFile(BUDGET)]);
  await expectStatus(budgetCard(page, "MB AB"), "new");
  await expectStatus(budgetCard(page, "MB Restart"), "new");

  await mapBudgetSheet(page, "MB AB");
  await reviewBudgetSheet(page, "MB AB", 4);
  // The MB AB template names its sheet, so the other sheet waits for a template of its own.
  await expectStatus(budgetCard(page, "MB Restart"), "new");
  await mapBudgetSheet(page, "MB Restart");
  await reviewBudgetSheet(page, "MB Restart", 3);
  await expectStatus(budgetCard(page, "MB AB"), "published");
  await expectStatus(budgetCard(page, "MB Restart"), "published");
});
