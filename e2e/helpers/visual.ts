// Visual checks of whatever a page shows right now: no horizontal overflow, only brand colours
// in every painted computed style, and a full-page screenshot attached to the test. Failures are
// soft, so one run reports every view and still takes every screenshot.
//
// The scans run inside the page and must stay self-contained (Playwright serialises them).
// Offenders are reported by selector, never by text: text could be a personal dimension value.
import { expect, test, type Page } from "@playwright/test";
import { BRAND_COLORS } from "@/components/brand/tokens";

/** Per sRGB channel (0–255). The closest two palette colours are 4 apart (#D1D3D3, #D3D6D7). */
const TOLERANCE = 1.0;

const BUSY = '[aria-busy="true"], [data-slot="skeleton"]';

/** Network quiet, fonts loaded, no loading markers, and two frames painted after that. */
export async function settle(page: Page, { loadingState = false } = {}) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (!loadingState) await page.waitForFunction((busy) => !document.querySelector(busy), BUSY);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

interface OverflowOffender {
  selector: string;
  left: number;
  right: number;
}

interface OverflowResult {
  scrollWidth: number;
  innerWidth: number;
  offenders: OverflowOffender[];
}

/**
 * Compares against the configured viewport width: under mobile emulation Chrome widens the
 * layout viewport (innerWidth) to fit overflowing content, so innerWidth growing is itself a
 * failure signal.
 */
function overflowInPage(viewportWidth: number): OverflowResult {
  const doc = document.scrollingElement ?? document.documentElement;
  const result: OverflowResult = {
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    offenders: [],
  };
  if (doc.scrollWidth <= viewportWidth + 1 && window.innerWidth <= viewportWidth + 1) {
    return result;
  }
  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    for (let n: Element | null = el; n && parts.length < 4; n = n.parentElement) {
      const id = n.getAttribute("data-testid") ?? n.getAttribute("data-slot");
      if (id) {
        parts.unshift(
          `${n.localName}[${n.hasAttribute("data-testid") ? "data-testid" : "data-slot"}="${id}"]`,
        );
        break;
      }
      const cls = (n.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
      parts.unshift(n.localName + cls.map((c) => `.${CSS.escape(c)}`).join(""));
    }
    return parts.join(" > ");
  };
  const clipsX = (cs: CSSStyleDeclaration) =>
    cs.overflowX !== "visible" ||
    cs.contain.includes("paint") ||
    cs.clipPath !== "none" ||
    cs.clip !== "auto";
  const hits: Element[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const left = r.left + window.scrollX;
    const right = r.right + window.scrollX;
    if (right <= viewportWidth + 1 && left >= -1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    // Fixed boxes outside the viewport (closed sheets, popper wrappers) add no scroll width.
    if (cs.position === "fixed" && (r.right <= 0 || r.left >= viewportWidth)) continue;
    let contained = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (clipsX(getComputedStyle(a))) {
        contained = true;
        break;
      }
    }
    if (!contained) hits.push(el);
  }
  // Only the outermost offenders: their descendants overflow with them.
  for (const el of hits) {
    if (hits.some((other) => other !== el && other.contains(el))) continue;
    const r = el.getBoundingClientRect();
    result.offenders.push({
      selector: selectorOf(el),
      left: Math.round(r.left + window.scrollX),
      right: Math.round(r.right + window.scrollX),
    });
  }
  return result;
}

interface ColorOffender {
  selector: string;
  prop: string;
  rgb: string;
  reason: string;
}

interface ColorScanOptions {
  palette: readonly string[];
  tolerance: number;
}

function colorsInPage({ palette, tolerance }: ColorScanOptions): ColorOffender[] {
  const pal = palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const probe = document.createElement("span");
  probe.setAttribute("data-brand-probe", "");
  probe.style.display = "none";
  document.documentElement.appendChild(probe);
  const cache = new Map<string, number[] | null>();
  // Chromium serialises computed colours as rgb(), oklab() (Tailwind's /alpha), oklch(),
  // color(srgb …) and more; relative colour syntax turns each into sRGB numbers.
  const toRgba = (value: string): number[] | null => {
    const hit = cache.get(value);
    if (hit !== undefined) return hit;
    probe.style.color = "";
    probe.style.color = `color(from ${value} srgb r g b / alpha)`;
    let out: number[] | null = null;
    if (probe.style.color) {
      const m = /color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([-\d.e]+))?\)/.exec(
        getComputedStyle(probe).color,
      );
      if (m) {
        out = [
          Number(m[1]) * 255,
          Number(m[2]) * 255,
          Number(m[3]) * 255,
          m[4] === undefined ? 1 : Number(m[4]),
        ];
      }
    }
    cache.set(value, out);
    return out;
  };
  const isGreen = ([r = 0, g = 0, b = 0]: number[]) => {
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (d < 20 || max !== g) return false;
    const hue = (60 * ((b - r) / d) + 120 + 360) % 360;
    return hue >= 60 && hue <= 180;
  };
  const COLOR_TOKEN =
    /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}\b/gi;
  const SVG_PAINTED = new Set([
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "use",
  ]);
  const SVG_NONRENDER =
    "defs, clipPath, mask, marker, pattern, symbol, linearGradient, radialGradient, filter, title, desc, metadata";
  const SKIP = "[data-brand-probe], next-route-announcer, nextjs-portal";
  const selectorOf = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    for (let n: Element | null = el; n && parts.length < 5; n = n.parentElement) {
      let part = n.localName;
      const id = n.getAttribute("data-testid") ?? n.getAttribute("data-slot");
      if (id) {
        parts.unshift(
          `${part}[${n.hasAttribute("data-testid") ? "data-testid" : "data-slot"}="${id}"]`,
        );
        break;
      }
      const cls = (n.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += cls.map((c) => `.${CSS.escape(c)}`).join("");
      parts.unshift(part);
    }
    return parts.join(" > ");
  };

  const offenders: ColorOffender[] = [];
  const report = (el: Element, pseudo: string, prop: string, rgb: string, reason: string) =>
    offenders.push({ selector: selectorOf(el) + pseudo, prop, rgb, reason });
  const check = (el: Element, pseudo: string, prop: string, value: string) => {
    if (!value || value === "none") return;
    for (const token of value.match(COLOR_TOKEN) ?? []) {
      const rgba = toRgba(token);
      if (!rgba) {
        report(el, pseudo, prop, token, "unparsed");
        continue;
      }
      if (rgba[3] === 0) continue;
      if (pal.some((p) => p.every((c, i) => Math.abs(c - (rgba[i] ?? 0)) <= tolerance))) continue;
      const rgb = `rgb(${rgba
        .slice(0, 3)
        .map((x) => Math.round(x))
        .join(", ")})`;
      report(el, pseudo, prop, rgb, isGreen(rgba) ? "green" : "off-palette");
    }
  };
  const checkStyle = (el: Element, cs: CSSStyleDeclaration, pseudo: string) => {
    const isSvg = el instanceof SVGElement;
    if (!isSvg || el.localName === "svg" || el.localName === "foreignObject") {
      // `color` paints glyphs only; currentColor consumers are checked through their own
      // resolved properties, so wrappers without text (<html> reports black) are skipped.
      const paintsText =
        pseudo !== "" ||
        el.matches("input, textarea, select, button") ||
        [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (paintsText) check(el, pseudo, "color", cs.color);
      check(el, pseudo, "background-color", cs.backgroundColor);
      check(el, pseudo, "background-image", cs.backgroundImage.replace(/url\([^)]*\)/g, ""));
      for (const side of ["top", "right", "bottom", "left"]) {
        const width = parseFloat(cs.getPropertyValue(`border-${side}-width`));
        const style = cs.getPropertyValue(`border-${side}-style`);
        if (width > 0 && style !== "none" && style !== "hidden") {
          check(el, pseudo, `border-${side}-color`, cs.getPropertyValue(`border-${side}-color`));
        }
      }
      if (cs.textDecorationLine !== "none") {
        check(el, pseudo, "text-decoration-color", cs.textDecorationColor);
      }
    }
    if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) {
      check(el, pseudo, "outline-color", cs.outlineColor);
    }
    check(el, pseudo, "box-shadow", cs.boxShadow);
    check(el, pseudo, "text-shadow", cs.textShadow);
    if (el.matches("input[type=checkbox], input[type=radio], input[type=range], progress, meter")) {
      if (cs.accentColor === "auto") report(el, pseudo, "accent-color", "auto", "browser default");
      else check(el, pseudo, "accent-color", cs.accentColor);
    }
    if (isSvg && SVG_PAINTED.has(el.localName) && !el.closest(SVG_NONRENDER)) {
      if (!cs.fill.startsWith("url(")) check(el, pseudo, "fill", cs.fill);
      if (!cs.stroke.startsWith("url(") && parseFloat(cs.strokeWidth) > 0) {
        check(el, pseudo, "stroke", cs.stroke);
      }
    }
    if (isSvg && el.localName === "stop") check(el, pseudo, "stop-color", cs.stopColor);
  };

  const elements: Element[] = [];
  const roots: (Document | ShadowRoot)[] = [document];
  for (let root = roots.pop(); root; root = roots.pop()) {
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(SKIP)) continue;
      if (el.shadowRoot) roots.push(el.shadowRoot);
      elements.push(el);
    }
  }
  for (const el of elements) {
    const cs = getComputedStyle(el);
    const rendered = el.localName === "stop" || el.getClientRects().length > 0;
    if (!rendered || cs.visibility === "hidden" || cs.visibility === "collapse") continue;
    checkStyle(el, cs, "");
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content !== "none" && ps.content !== "normal") checkStyle(el, ps, pseudo);
    }
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.placeholder &&
      !el.value
    ) {
      check(el, "::placeholder", "color", getComputedStyle(el, "::placeholder").color);
    }
  }
  probe.remove();
  return offenders;
}

/** One line per (property, colour, reason) with up to five example selectors. */
function groupColorOffenders(offenders: readonly ColorOffender[]): string {
  const groups = new Map<string, Set<string>>();
  for (const o of offenders) {
    const key = `${o.reason} ${o.prop} ${o.rgb}`;
    const selectors = groups.get(key) ?? new Set<string>();
    selectors.add(o.selector);
    groups.set(key, selectors);
  }
  return [...groups]
    .map(([key, selectors]) => {
      const examples = [...selectors].slice(0, 5).join("\n      ");
      return `  ${key} (${selectors.size} element(s))\n      ${examples}`;
    })
    .join("\n");
}

function formatOverflow(result: OverflowResult, viewportWidth: number): string {
  if (result.scrollWidth <= viewportWidth + 1 && result.innerWidth <= viewportWidth + 1) return "";
  const offenders = result.offenders
    .slice(0, 10)
    .map((o) => `      ${o.selector} (${o.left}–${o.right}px)`)
    .join("\n");
  return (
    `  scrollWidth ${result.scrollWidth}px, innerWidth ${result.innerWidth}px, viewport ` +
    `${viewportWidth}px\n${offenders}`
  );
}

export interface CheckViewOptions {
  /** Whole scrollable page (default) or the viewport only, e.g. with a popover open. */
  fullPage?: boolean;
  /** The page shows a skeleton on purpose (the design system), so loading markers stay. */
  loadingState?: boolean;
}

/**
 * Settles the page, checks overflow and colours (soft) and attaches a screenshot named after
 * the view. Call it after every navigation and every state change worth a look.
 */
export async function checkView(page: Page, name: string, options: CheckViewOptions = {}) {
  const testInfo = test.info();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("checkView needs a fixed viewport.");
  await settle(page, { loadingState: options.loadingState });

  const overflow = formatOverflow(
    await page.evaluate(overflowInPage, viewport.width),
    viewport.width,
  );
  expect.soft(overflow, `${name}: wider than the ${viewport.width}px viewport`).toBe("");

  const colors = groupColorOffenders(
    await page.evaluate(colorsInPage, { palette: BRAND_COLORS, tolerance: TOLERANCE }),
  );
  expect.soft(colors, `${name}: colours outside the brand palette`).toBe("");

  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    path,
    fullPage: options.fullPage ?? true,
    animations: "disabled",
    caret: "hide",
  });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
