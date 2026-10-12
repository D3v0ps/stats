// Texts for deleting an import template. Uploads read with it keep their numbers: the
// database nulls their template link (the version stays as history), so a template in use
// can be deleted too; the dialog says what happens to those uploads.
import { formatNumber } from "@/lib/core/format-sv";

function uploadsText(uses: number): string {
  return `${formatNumber(uses)} ${uses === 1 ? "uppladdning" : "uppladdningar"}`;
}

/** The paragraphs of the confirmation dialog. */
export function templateDeleteDescription(name: string, uses: number): string[] {
  const out = [
    `”${name}” och alla dess versioner tas bort. Filer av den här sorten känns inte längre igen automatiskt.`,
  ];
  if (uses > 0) {
    out.push(
      `${uploadsText(uses)} har lästs med mallen. Deras siffror ligger kvar och kan fortfarande dras tillbaka, men i historiken visas de utan mall.`,
    );
  }
  out.push("Det går inte att ångra.");
  return out;
}

/** The toast after deleting. */
export function templateDeletedMessage(uses: number): string {
  return uses > 0
    ? `Mallen är borttagen. Siffrorna från ${uploadsText(uses)} ligger kvar.`
    : "Mallen är borttagen.";
}
