// Sonner paints toasts from a stylesheet it injects at runtime, which neither Tailwind's
// output nor the src/** scan sees. Every off-palette colour in it must be one the Toaster in
// src/components/ui/sonner.tsx overrides.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ToastClassnames } from "sonner";
import { describe, expect, it } from "vitest";
import { toastClassNames, toasterStyle, toastIcons } from "@/components/ui/sonner";
import { cssColorOffenders } from "./palette-audit";

const stylesheet = readFileSync(
  fileURLToPath(new URL("../../../node_modules/sonner/dist/styles.css", import.meta.url)),
  "utf8",
);

// Never rendered: rich colours and inverted toasts are never switched on, the one Toaster is
// light (app layout test) and the Toaster's loading icon replaces sonner's spinner.
const NOT_RENDERED =
  /\[data-rich-colors=|\[data-invert=|\[data-sonner-theme='dark'\]|\.sonner-loading-bar/;

// Sonner 2.0.8's off-palette declarations and, by toastClassNames key, the important utility
// that overrides each. An upgrade that adds a colour fails until it is overridden too. (The
// utilities are the ones sonner.tsx uses, so naming them here adds nothing to the build.)
const OVERRIDES: Record<string, [keyof ToastClassnames, `${string}!`][]> = {
  "[data-sonner-toast][data-styled='true'] { box-shadow }": [["toast", "shadow-md!"]],
  "[data-sonner-toast]:focus-visible { box-shadow }": [["toast", "focus-visible:ring-3!"]],
  "[data-sonner-toast][data-styled='true'] [data-description] { color }": [
    ["description", "text-muted-foreground!"],
  ],
  "[data-sonner-toast][data-styled='true'] [data-button]:focus-visible { box-shadow }": [
    ["actionButton", "focus-visible:ring-3!"],
    ["cancelButton", "focus-visible:ring-3!"],
  ],
  "[data-sonner-toast][data-styled='true'] [data-cancel] { background }": [
    ["cancelButton", "bg-muted!"],
  ],
  "[data-sonner-toast][data-styled='true'] [data-close-button]:focus-visible { box-shadow }": [
    ["closeButton", "focus-visible:ring-3!"],
  ],
  "[data-sonner-toast][data-styled='true']:hover [data-close-button]:hover { background }": [
    ["closeButton", "hover:bg-muted!"],
  ],
  "[data-sonner-toast][data-styled='true']:hover [data-close-button]:hover { border-color }": [
    ["closeButton", "hover:border-border!"],
  ],
};

interface Rule {
  selector: string;
  declarations: [property: string, value: string][];
}

/** Innermost rules (inside `@media` too), with whitespace in selectors collapsed. */
function rules(css: string): Rule[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
    selector: selector.trim().replace(/\s+/g, " "),
    declarations: body
      .split(";")
      .filter((declaration) => declaration.includes(":"))
      .map((declaration) => {
        const colon = declaration.indexOf(":");
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
      }),
  }));
}

/**
 * `selector { property }` of each rendered declaration whose colour is off-palette. Custom
 * properties only paint where they are used, so values are judged with var() resolved and
 * the Toaster's inline style on top of sonner's defaults.
 */
function offenders(css: string): string[] {
  const rendered = rules(css).filter(({ selector }) => !NOT_RENDERED.test(selector));
  const vars = new Map<string, string>();
  for (const { declarations } of rendered) {
    for (const [property, value] of declarations) {
      if (property.startsWith("--")) vars.set(property, value);
    }
  }
  for (const [property, value] of Object.entries(toasterStyle)) vars.set(property, String(value));
  const resolve = (value: string): string =>
    value.replace(/var\((--[\w-]+)[^()]*\)/g, (whole, name: string) => {
      const resolved = vars.get(name);
      return resolved === undefined ? whole : resolve(resolved);
    });

  const found = new Set<string>();
  for (const { selector, declarations } of rendered) {
    const painting = declarations
      .filter(([property]) => !property.startsWith("--"))
      .map(([property, value]) => `${property}:${resolve(value)}`);
    for (const offender of cssColorOffenders(`{${painting.join(";")}}`)) {
      found.add(`${selector} { ${offender.slice(0, offender.indexOf(":"))} }`);
    }
  }
  return [...found];
}

describe("<Toaster> against sonner's stylesheet", () => {
  it("overrides every off-palette colour sonner paints with an important utility", () => {
    expect(offenders(stylesheet).sort()).toEqual(Object.keys(OVERRIDES).sort());
    for (const [declaration, overrides] of Object.entries(OVERRIDES)) {
      for (const [key, utility] of overrides) {
        expect((toastClassNames[key] ?? "").split(/\s+/), `${declaration}: ${key}`).toContain(
          utility,
        );
      }
    }
  });

  it("replaces sonner's grey spinner with its own loading icon", () => {
    expect(toastIcons?.loading).toBeDefined();
  });
});
