// Every route at every viewport, with the seeded data: no horizontal overflow, only brand
// colours, no CSP violation (fixtures.ts) and a screenshot per view. Also a few states worth a
// look: a chart tooltip, an open select, a dialog, a toast and the mobile menu; and the deck's
// bar charts, which clip their own content, so a cut-off name never shows up as overflow.
//
// Read-only apart from its own report template (deleted afterwards) and the shared frozen
// standard report, which the first spec that needs it freezes (frozen reports cannot be deleted).
import type { Locator, Page } from "@playwright/test";
import { defaultReportSpec } from "@/lib/present/default-report";
import { SETTINGS_SECTIONS } from "@/lib/settings-ui/sections";
import { expect, test } from "./fixtures";
import { loginPassword } from "./helpers/auth";
import { dimensionValueId, someImportTemplateId } from "./helpers/catalog";
import {
  FROZEN_STANDARD_TITLE,
  REPORT_MONTH,
  STANDARD_SLIDES,
  insertReportTemplate,
  removeReportTemplate,
  slideName,
} from "./helpers/reports";
import { checkView } from "./helpers/visual";

const CUSTOMER = "Budbee Södertälje";

interface Ids {
  template: string;
  frozen: string;
  customer: number;
  importTemplate: string;
}
let ids: Ids | null = null;
const seeded = (): Ids => {
  if (!ids) throw new Error("beforeAll did not run.");
  return ids;
};

test.beforeAll(async ({ frozenReport }, testInfo) => {
  const frozen = await frozenReport();
  const customer = await dimensionValueId("kund", CUSTOMER);
  const importTemplate = await someImportTemplateId();
  // Last, so a failed lookup leaves no template behind.
  const template = await insertReportTemplate(
    defaultReportSpec(`E2E visuell ${testInfo.project.name}`),
  );
  ids = { template, frozen, customer, importTemplate };
});

test.afterAll(async () => {
  if (ids) await removeReportTemplate(ids.template);
});

const heading = (page: Page, name: string | RegExp) =>
  expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

interface View {
  name: string;
  path: (ids: Ids) => string;
  ready: (page: Page) => Promise<void>;
  status?: number;
  loadingState?: boolean;
}

const VIEWS: View[] = [
  {
    name: "oversikt",
    path: () => `/?manad=${REPORT_MONTH}`,
    ready: (page) => expect(page.getByTestId("widget-timmar")).toBeVisible(),
  },
  {
    name: "utforska",
    path: () => `/utforska?matt=timmar&grupp=bolag&manad=${REPORT_MONTH}`,
    ready: (page) => expect(page.getByTestId("pivot-row").first()).toBeVisible(),
  },
  {
    name: "utforska-kund",
    path: ({ customer }) => `/utforska/kund/${customer}?bolag=MBAB&manad=${REPORT_MONTH}`,
    ready: (page) => heading(page, CUSTOMER),
  },
  {
    name: "ladda-upp",
    path: () => "/ladda-upp",
    ready: (page) => heading(page, "Ladda upp"),
  },
  {
    name: "ladda-upp-historik",
    path: () => "/ladda-upp/historik",
    ready: (page) => expect(page.getByTestId("history-row").first()).toBeVisible(),
  },
  {
    name: "rapporter",
    path: () => "/rapporter",
    ready: (page) => expect(page.getByTestId("template-card").first()).toBeVisible(),
  },
  {
    name: "rapport-redigera",
    path: ({ template }) => `/rapporter/${template}`,
    ready: async (page) => {
      await expect(page.getByTestId("slide-item")).toHaveCount(9);
      await expect(page.getByTestId("slide-preview")).not.toContainText("Uppdaterar");
    },
  },
  {
    name: "presentera",
    path: ({ template }) => `/presentera/${template}?manad=${REPORT_MONTH}`,
    ready: (page) => expect(page.getByRole("region", { name: slideName(1) })).toBeVisible(),
  },
  {
    name: "presentera-bild-8",
    path: ({ template }) => `/presentera/${template}?manad=${REPORT_MONTH}&bild=8`,
    ready: (page) => expect(page.getByRole("region", { name: slideName(8) })).toBeVisible(),
  },
  {
    name: "presentera-manus",
    path: ({ template }) => `/presentera/${template}/manus?manad=${REPORT_MONTH}`,
    ready: (page) => expect(page.getByTestId("notes-text")).toBeVisible(),
  },
  {
    name: "arkiv",
    path: ({ frozen }) => `/rapporter/arkiv/${frozen}`,
    ready: (page) => heading(page, FROZEN_STANDARD_TITLE),
  },
  {
    name: "arkiv-presentera",
    path: ({ frozen }) => `/presentera/arkiv/${frozen}?bild=5`,
    ready: (page) => expect(page.getByRole("region", { name: slideName(5) })).toBeVisible(),
  },
  {
    name: "arkiv-manus",
    path: ({ frozen }) => `/presentera/arkiv/${frozen}/manus`,
    ready: (page) => expect(page.getByTestId("notes-text")).toBeVisible(),
  },
  {
    name: "arkiv-utskrift",
    path: ({ frozen }) => `/presentera/arkiv/${frozen}/utskrift`,
    ready: (page) => expect(page.getByTestId("print-page")).toHaveCount(9),
  },
  {
    name: "installningar",
    path: () => "/installningar",
    ready: (page) => heading(page, "Inställningar"),
  },
  ...SETTINGS_SECTIONS.map((s): View => ({
    name: `installningar-${s.slug}`,
    path: () => s.href,
    ready: (page) =>
      expect(page.getByTestId(`settings-nav-${s.slug}`)).toHaveAttribute("aria-current", "page"),
  })),
  {
    name: "installningar-dimension-kund",
    path: () => "/installningar/dimensioner/kund",
    ready: (page) => expect(page.getByTestId("dimension-values")).toBeVisible(),
  },
  {
    name: "installningar-importmall",
    path: ({ importTemplate }) => `/installningar/importmallar/${importTemplate}`,
    ready: (page) => expect(page.getByText("Versioner").first()).toBeVisible(),
  },
  {
    name: "designsystem",
    path: () => "/designsystem",
    ready: (page) => heading(page, "Designsystem"),
    loadingState: true,
  },
  {
    name: "404",
    path: () => "/finns-inte",
    ready: (page) => heading(page, "Sidan finns inte"),
    status: 404,
  },
];

for (const view of VIEWS) {
  test(`${view.name}`, async ({ page }) => {
    const response = await page.goto(view.path(seeded()));
    expect(response?.status()).toBe(view.status ?? 200);
    await view.ready(page);
    await checkView(page, view.name, { loadingState: view.loadingState });
  });
}

test.describe("signed out", () => {
  test.use({ anonymous: true });

  test("logga-in", async ({ page }) => {
    await page.goto("/logga-in");
    await expect(page.getByLabel("Lösenord")).toBeVisible();
    await checkView(page, "logga-in");
  });
});

test.describe("states", () => {
  for (const widget of ["resultat-per-manad", "deltagare-per-verksamhet"]) {
    test(`a chart tooltip on the overview: ${widget}`, async ({ page }) => {
      await page.goto(`/?manad=${REPORT_MONTH}`);
      const card = page.getByTestId(`widget-${widget}`);
      await card.locator(".recharts-surface").hover();
      await expect(card.locator(".recharts-tooltip-wrapper")).toBeVisible();
      await checkView(page, `oversikt-tooltip-${widget}`, { fullPage: false });
    });
  }

  test("an open select on the overview", async ({ page }) => {
    await page.goto(`/?manad=${REPORT_MONTH}`);
    await page.getByRole("combobox", { name: "Period" }).click();
    await expect(page.getByRole("option", { name: "Hittills i år" })).toBeVisible();
    await checkView(page, "oversikt-period", { fullPage: false });
    await page.keyboard.press("Escape");
  });

  test("a confirmation dialog in Säkerhet", async ({ page }) => {
    await page.goto("/installningar/sakerhet");
    await page.getByTestId("logout-everywhere").click();
    const dialog = page.getByTestId("logout-everywhere-dialog");
    await expect(dialog).toBeVisible();
    await checkView(page, "sakerhet-dialog", { fullPage: false });
    await dialog.getByRole("button", { name: "Avbryt" }).click();
    await expect(dialog).toBeHidden();
  });

  test("a toast in Säkerhet", async ({ page }) => {
    // The current password again: Auth refuses it, so nothing changes, and the browser's own
    // call to Supabase runs under the CSP.
    await page.goto("/installningar/sakerhet");
    await page.getByTestId("password-new").fill(loginPassword());
    await page.getByTestId("password-repeat").fill(loginPassword());
    await page.getByTestId("password-save").click();
    await expect(
      page.getByText("Det nya lösenordet måste skilja sig från det nuvarande."),
    ).toBeVisible();
    await checkView(page, "sakerhet-toast", { fullPage: false });
  });

  test("the menu sheet on a phone", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 1024, "The sidebar replaces the menu from lg.");
    await page.goto(`/?manad=${REPORT_MONTH}`);
    await page.getByRole("button", { name: "Öppna menyn" }).click();
    await expect(page.getByRole("dialog", { name: "Meny" })).toBeVisible();
    await checkView(page, "mobil-meny", { fullPage: false });
  });
});

/** The category labels of a horizontal bar chart (Recharts draws them in their own layer). */
const BAR_NAMES = ".recharts-yAxis-tick-labels text";

/**
 * The category names of a slide's horizontal bars that a reader cannot read whole: drawn
 * outside what the chart shows (its SVG and every clipping box around it), or cut short
 * without "…" and the full name as the label's title.
 */
function unreadableBarNames(slide: Locator): Promise<string[]> {
  return slide.evaluate((section, selector) => {
    const problems: string[] = [];
    for (const figure of section.querySelectorAll('[data-slot="chart-figure"]')) {
      const svg = figure.querySelector("svg.recharts-surface");
      if (!svg) continue;
      const names = [...figure.querySelectorAll('th[scope="row"]')].map(
        (th) => th.textContent?.trim() ?? "",
      );
      let { left, right } = svg.getBoundingClientRect();
      for (let el = svg.parentElement; el; el = el.parentElement) {
        if (getComputedStyle(el).overflowX === "visible") continue;
        const box = el.getBoundingClientRect();
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      for (const label of svg.querySelectorAll(selector)) {
        const shown = [...label.childNodes]
          .filter((n) => n.nodeName !== "title")
          .map((n) => n.textContent ?? "")
          .join("");
        const name = label.querySelector("title")?.textContent ?? shown;
        const box = label.getBoundingClientRect();
        if (box.left < left - 0.5 || box.right > right + 0.5) {
          problems.push(
            `"${shown}" is drawn at ${Math.round(box.left)}–${Math.round(box.right)} px, ` +
              `the chart shows ${Math.round(left)}–${Math.round(right)} px`,
          );
        }
        if (!names.includes(name)) problems.push(`"${name}" is no category of the chart`);
        else if (
          shown !== name &&
          !(shown.endsWith("…") && name.startsWith(shown.slice(0, -1).trimEnd()))
        ) {
          problems.push(`"${shown}" is not a cut "${name}"`);
        }
      }
    }
    return problems;
  }, BAR_NAMES);
}

test("the deck's bar charts show every name whole or cut with its full name", async ({
  page,
}, testInfo) => {
  let names = 0;
  for (let n = 1; n <= STANDARD_SLIDES; n++) {
    // Each slide by its own URL: a key press sent before hydration would be lost.
    await page.goto(`/presentera/${seeded().template}?manad=${REPORT_MONTH}&bild=${n}`);
    const slide = page.getByRole("region", { name: slideName(n) });
    await expect(slide).toBeVisible();
    if ((await slide.locator('[data-visual="bars"]').count()) > 0) {
      const labels = slide.locator(BAR_NAMES);
      await expect(labels.first()).toBeVisible();
      // Polled: the labels are measured again once the web font has loaded.
      await expect
        .poll(() => unreadableBarNames(slide), { message: `${slideName(n)}: bar names` })
        .toEqual([]);
      // On a projector the standard report's names fit, so a cut one means the axis is too narrow.
      if (testInfo.project.name === "projektor") {
        const cut = await labels.evaluateAll((els) =>
          els.filter((el) => el.querySelector("title")).map((el) => el.textContent ?? ""),
        );
        expect(cut, `${slideName(n)}: names cut on a projector`).toEqual([]);
      }
      names += await labels.count();
    }
  }
  // The standard report has horizontal bars (participants per verksamhet, top customers).
  expect(names).toBeGreaterThan(0);
});
