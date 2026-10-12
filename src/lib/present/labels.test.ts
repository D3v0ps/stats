import { describe, expect, it } from "vitest";
import {
  frozenMeta,
  lockedBanner,
  lockedShortLabel,
  monthTitle,
  slideCountLabel,
  templateMeta,
} from "./labels";

describe("report labels", () => {
  it("names months and counts slides", () => {
    expect(monthTitle("2026-09")).toBe("September 2026");
    expect(slideCountLabel(1)).toBe("1 bild");
    expect(slideCountLabel(0)).toBe("0 bilder");
    expect(slideCountLabel(9)).toBe("9 bilder");
  });

  it("describes templates and frozen reports", () => {
    expect(templateMeta(9, "2026-10-12T08:30:00Z")).toBe("9 bilder · uppdaterad 12 okt 2026");
    expect(frozenMeta("2026-10-12T21:30:00Z", "2026-09")).toBe(
      "Fryst 12 okt 2026 · September 2026",
    );
    // Late evening UTC is already the next day in Stockholm.
    expect(frozenMeta("2026-10-12T22:30:00Z", "2026-09")).toBe(
      "Fryst 13 okt 2026 · September 2026",
    );
  });

  it("states that a frozen report never changes", () => {
    expect(lockedShortLabel("2026-10-12T08:00:00Z")).toBe("Låst version från 12 okt 2026");
    expect(lockedBanner("2026-10-12T08:00:00Z")).toBe(
      "Låst version från 12 okt 2026 – siffrorna ändras inte när ny data laddas upp",
    );
  });
});
