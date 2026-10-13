// Spec E: undoing a publish in Historik. Spec B's UTF-16 export replaced the September numbers
// Spec A published; undoing it (a reason is required) makes Spec A's file the current version of
// September again. Nothing is deleted: the undone upload stays in the list.
import { formatMonthShort } from "@/lib/core/month";
import { expect, test } from "../fixtures";
import { serverDateToday } from "../helpers/upload";

const SEP = "intelliplan_timmar_MBAB_2026-09.xlsx";
const UTF16 = "intelliplan_timmar_MBAB_2026-09_utf16.csv";
const REASON = "Fel exportformat, xlsx-filen gäller";

test("undo the replacing September upload", async ({ page }) => {
  await page.goto("/ladda-upp/historik");
  await expect(page.getByRole("heading", { level: 1, name: "Historik" })).toBeVisible();
  const row = (fileName: string) => page.getByTestId("history-row").filter({ hasText: fileName });
  await expect(row(UTF16)).toHaveAttribute("data-status", "published");
  await expect(row(SEP)).toHaveAttribute("data-status", "replaced");

  await row(UTF16).getByTestId("retract-button").click();
  const dialog = page.getByTestId("retract-dialog");
  await expect(dialog).toContainText(
    `${UTF16} (${formatMonthShort("2026-09")}) tas bort ur siffrorna. Den tidigare versionen av samma månader gäller igen.`,
  );
  await dialog.getByTestId("retract-reason").fill("ok");
  await dialog.getByTestId("retract-dialog-submit").click();
  await expect(dialog.getByRole("alert")).toHaveText("Skriv kort varför publiceringen ångras.");
  await dialog.getByTestId("retract-reason").fill(REASON);
  await dialog.getByTestId("retract-dialog-submit").click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId("retract-notice")).toHaveText(
    `${UTF16}: Publiceringen är ångrad. Föregående version är tillbaka för 1 månad.`,
  );
  await expect(row(UTF16)).toHaveAttribute("data-status", "retracted");
  await expect(row(UTF16)).toContainText(`Återkallad ${serverDateToday()}: ${REASON}`);
  await expect(row(UTF16).getByTestId("retract-button")).toHaveCount(0);
  await expect(row(SEP)).toHaveAttribute("data-status", "published");
  await expect(row(SEP)).toContainText("Publicerad");

  // Still true after a fresh load: the server, not the page, holds the current version.
  await page.reload();
  await expect(row(UTF16)).toHaveAttribute("data-status", "retracted");
  await expect(row(SEP)).toHaveAttribute("data-status", "published");
});
