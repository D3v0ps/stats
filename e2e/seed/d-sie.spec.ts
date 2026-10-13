// Spec D: Fortnox SIE files need no template. The company comes from the organisation number:
// one file per company is reviewed and published together, and a file from an unknown company
// stops in the queue.
import { formatAmount, formatNumber } from "@/lib/core/format-sv";
import { expect, test } from "../fixtures";
import { sieFile, sieTruth } from "../helpers/truth";
import {
  SLOW,
  addFiles,
  expectPhase,
  expectStatus,
  openUploadPage,
  queueCard,
  removeFromQueue,
  reviewPanel,
} from "../helpers/upload";

const MBAB = "mbab_2026_psaldo.se";
const MBR = "mbr_2026_trans_only.se";
const UNKNOWN = "unknown_org.se";

const resultYtd = (file: string) => {
  const year = sieTruth(file).years["0"];
  if (!year) throw new Error(`${file} has no current fiscal year in its truth file`);
  return formatAmount(year.resultYtd);
};

test("SIE: both companies from the org number, an unknown company stops", async ({ page }) => {
  await openUploadPage(page);
  await addFiles(page, [sieFile(MBAB), sieFile(MBR), sieFile(UNKNOWN)]);

  await expectStatus(queueCard(page, MBAB), "ready");
  await expect(queueCard(page, MBAB)).toContainText("MB AB (från organisationsnumret)");
  await expectStatus(queueCard(page, MBR), "ready");
  await expect(queueCard(page, MBR)).toContainText("MB Restart (från organisationsnumret)");

  const unknown = queueCard(page, UNKNOWN);
  await expectStatus(unknown, "error");
  await expect(unknown.getByTestId("status-chip")).toHaveText("Fel");
  await expect(unknown.getByTestId("queue-message")).toHaveText(
    "Bolaget kunde inte avgöras från organisationsnumret. Filen kan inte publiceras.",
  );
  await expect(unknown.getByTestId("review-button")).toHaveCount(0);

  await page.getByTestId("review-all-button").click();
  await expect(page.getByRole("heading", { level: 2, name: "Granska alla" })).toBeVisible();
  await expect(page.getByTestId("review-panel")).toHaveCount(2);

  const mbab = reviewPanel(page, MBAB);
  await expectPhase(mbab, "ready");
  const mbabChecks = mbab.getByTestId("sie-checks");
  await expect(mbabChecks).toContainText("MB AB (org.nr 556959-9318)");
  await expect(mbabChecks).toContainText("Stämmer");
  await expect(mbabChecks.getByRole("row", { name: /Hittills i år/ })).toContainText(
    resultYtd(MBAB),
  );

  const mbr = reviewPanel(page, MBR);
  await expectPhase(mbr, "ready");
  const mbrChecks = mbr.getByTestId("sie-checks");
  await expect(mbrChecks).toContainText("MB Restart (org.nr 559208-9071)");
  await expect(mbrChecks.getByRole("row", { name: /Hittills i år/ })).toContainText(resultYtd(MBR));
  await expect(mbr.getByTestId("sie-warnings")).toContainText("Filen saknar #PSALDO");

  await page.getByTestId("publish-all-button").click();
  await expect(page.getByRole("status").filter({ hasText: "publicerade" })).toHaveText(
    `${formatNumber(2)} filer publicerade.`,
    SLOW,
  );
  await expect(mbab.getByTestId("published-summary")).toContainText("MB AB");
  await expect(mbr.getByTestId("published-summary")).toContainText("MB Restart");

  await page.getByTestId("back-button").click();
  await expectStatus(queueCard(page, MBAB), "published");
  await expectStatus(queueCard(page, MBR), "published");
  await removeFromQueue(page, UNKNOWN);
});
