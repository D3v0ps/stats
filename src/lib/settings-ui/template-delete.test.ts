import { describe, expect, it } from "vitest";
import { templateDeleteDescription, templateDeletedMessage } from "./template-delete";

describe("template delete texts", () => {
  it("tells what happens to uploads read with the template", () => {
    expect(templateDeleteDescription("Timmar", 0)).toEqual([
      "”Timmar” och alla dess versioner tas bort. Filer av den här sorten känns inte längre igen automatiskt.",
      "Det går inte att ångra.",
    ]);
    expect(templateDeleteDescription("Timmar", 3)[1]).toBe(
      "3 uppladdningar har lästs med mallen. Deras siffror ligger kvar och kan fortfarande dras tillbaka, men i historiken visas de utan mall.",
    );
    expect(templateDeleteDescription("Timmar", 1)[1]).toMatch(/^1 uppladdning har/);
  });

  it("confirms the delete", () => {
    expect(templateDeletedMessage(0)).toBe("Mallen är borttagen.");
    expect(templateDeletedMessage(2)).toBe(
      "Mallen är borttagen. Siffrorna från 2 uppladdningar ligger kvar.",
    );
  });
});
