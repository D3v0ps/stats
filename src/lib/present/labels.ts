// Swedish labels for report lists and the frozen-report banner.
import { formatDateSv } from "@/lib/core/format-sv";
import { formatMonthLong, type Month } from "@/lib/core/month";

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);
}

/** "September 2026" */
export function monthTitle(month: Month): string {
  return capitalize(formatMonthLong(month));
}

/** "1 bild", "9 bilder" */
export function slideCountLabel(count: number): string {
  return `${count} ${count === 1 ? "bild" : "bilder"}`;
}

/** "9 bilder · uppdaterad 12 okt 2026" */
export function templateMeta(slideCount: number, updatedAt: string): string {
  return `${slideCountLabel(slideCount)} · uppdaterad ${formatDateSv(updatedAt)}`;
}

/** "Fryst 12 okt 2026 · September 2026" */
export function frozenMeta(frozenAt: string, anchorMonth: Month): string {
  return `Fryst ${formatDateSv(frozenAt)} · ${monthTitle(anchorMonth)}`;
}

/** Short form for the deck: "Låst version från 12 okt 2026". */
export function lockedShortLabel(frozenAt: string): string {
  return `Låst version från ${formatDateSv(frozenAt)}`;
}

/** The archive banner. */
export function lockedBanner(frozenAt: string): string {
  return `${lockedShortLabel(frozenAt)} – siffrorna ändras inte när ny data laddas upp`;
}
