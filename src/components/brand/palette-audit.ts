// Finds colours outside the MB palette in CSS and source text. The brand tests run it over
// src/** and over the CSS Tailwind compiles from it, so black shadows, colour mixes, stray
// greys and green fail `pnpm test` instead of slipping into the UI.
import { BRAND_COLORS } from "./tokens";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseHex(token: string): Rgba | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(token);
  if (!match) return null;
  const digits = match[1]!;
  const hex = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { r: byte(0), g: byte(2), b: byte(4), a: hex.length === 8 ? byte(6) / 255 : 1 };
}

const PALETTE_RGB: readonly Rgba[] = BRAND_COLORS.map((hex) => parseHex(hex)!);

/** A number, a percentage of `scale`, or `none` (0), as CSS Color 4 allows. */
function channel(value: string, scale: number): number {
  if (value === "none") return 0;
  return value.endsWith("%") ? (parseFloat(value) / 100) * scale : parseFloat(value);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** rgb()/rgba()/hsl()/hsla() in legacy or modern syntax; `_` is a space in Tailwind classes. */
function parseRgbOrHsl(token: string): Rgba | null {
  const match = /^(rgba?|hsla?)\((.*)\)$/i.exec(token.replace(/_/g, " ").trim());
  if (!match) return null;
  const [main = "", alpha] = match[2]!.split("/");
  const parts = main.split(/[\s,]+/).filter(Boolean);
  const a =
    alpha !== undefined
      ? channel(alpha.trim(), 1)
      : parts.length === 4
        ? channel(parts.pop()!, 1)
        : 1;
  if (parts.length !== 3) return null;
  const [p0, p1, p2] = parts as [string, string, string];
  const [r, g, b] = match[1]!.toLowerCase().startsWith("rgb")
    ? [channel(p0, 255), channel(p1, 255), channel(p2, 255)]
    : hslToRgb(parseFloat(p0), channel(p1, 100) / 100, channel(p2, 100) / 100);
  return [r, g, b, a].some(Number.isNaN) ? null : { r, g, b, a };
}

/** Transparent, or a palette colour at any alpha (rounding tolerance of 1 per channel). */
function isPaletteColor(color: Rgba): boolean {
  if (color.a === 0) return true;
  return PALETTE_RGB.some(
    (p) =>
      Math.abs(p.r - color.r) <= 1 && Math.abs(p.g - color.g) <= 1 && Math.abs(p.b - color.b) <= 1,
  );
}

/** Index of the parenthesis closing the one at `open`, or the end of the text. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length - 1;
}

/** Splits on commas that are not inside parentheses. */
function topLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

/**
 * A mix with `transparent` is an alpha variant (Tailwind's `/50` modifiers compile to that)
 * and is checked through its colour. Mixing two colours yields a colour outside the palette.
 */
function colorMixOffenders(token: string): string[] {
  const inner = token.slice(token.indexOf("(") + 1, -1).replace(/_/g, " ");
  const colors = topLevelArgs(inner)
    .slice(1)
    .map((arg) => arg.replace(/(^|\s)-?[\d.]+%(\s|$)/g, " ").trim());
  const opaque = colors.filter((c) => c.toLowerCase() !== "transparent");
  if (opaque.length > 1) return [token];
  return opaque.flatMap((c) => colorOffenders(c));
}

// Attribute selectors such as shadcn's `[stroke='#ccc']` match Recharts' defaults in order to
// recolour them; they name a colour without painting it.
const ATTRIBUTE_SELECTOR = /\[[\w-]+=(["']?)#[0-9a-f]{3,8}\1\]/gi;
// `_` may precede or follow a token: it stands for a space inside Tailwind arbitrary values.
const COLOR_TOKEN =
  /(?<![a-z0-9-])(?:color-mix|rgba?|hsla?|hwb|lab|lch|oklab|oklch|color(?=\(\s*(?:from|srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)(?![a-z0-9-])))\(|(?<![a-z0-9&#-])#[0-9a-f]{3,8}(?![a-z0-9-])/gi;

/**
 * Colour literals outside the palette in a CSS value or source text: hex, rgb() and hsl()
 * (alpha allowed), colour mixes of two colours, and syntaxes the palette is not written in
 * (oklch(), lab(), color(), ...). Named colours are left to the context-aware checks.
 */
export function colorOffenders(text: string): string[] {
  const offenders: string[] = [];
  const source = text.replace(ATTRIBUTE_SELECTOR, "");
  const tokens = new RegExp(COLOR_TOKEN.source, COLOR_TOKEN.flags);
  for (let match = tokens.exec(source); match; match = tokens.exec(source)) {
    const head = match[0];
    if (head.startsWith("#")) {
      const color = parseHex(head);
      if (color && !isPaletteColor(color)) offenders.push(head);
      continue;
    }
    const end = closingParen(source, match.index + head.length - 1);
    const token = source.slice(match.index, end + 1);
    // Continue after the function so its arguments are not reported a second time.
    tokens.lastIndex = end + 1;
    // Without arguments it is a mention (in prose or a comment), not a colour.
    if (token.slice(head.length, -1).trim() === "") continue;
    const name = head.slice(0, -1).toLowerCase();
    if (name === "color-mix") offenders.push(...colorMixOffenders(token));
    else if (/^(rgba?|hsla?)$/.test(name)) {
      const color = parseRgbOrHsl(token);
      if (!color || !isPaletteColor(color)) offenders.push(token);
    } else offenders.push(token);
  }
  return offenders;
}

// CSS named and system colours. White is the only one in the palette.
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat whitesmoke yellow yellowgreen " +
    "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas " +
    "canvastext field fieldtext graytext highlight highlighttext linktext mark marktext " +
    "selecteditem selecteditemtext visitedtext"
  ).split(" "),
);

const COLOR_PROPERTY =
  "fill|stroke|color|stop-?color|flood-?color|lighting-?color|background(?:-?color)?|" +
  "border(?:-?(?:top|right|bottom|left|block|inline)(?:-?(?:start|end))?)?-?color|" +
  "outline-?color|caret-?color|accent-?color|text-?decoration-?color|column-?rule-?color|theme-?color";
// A colour property set to a name: SVG attributes, style objects and CSS declarations.
const NAMED_COLOR_ASSIGNMENT = new RegExp(
  `(?<![\\w-])(?:${COLOR_PROPERTY})\\s*[:=]\\s*\\{?\\s*["'\`]?([a-z]+)(?![\\w(-])`,
  "gi",
);
// A name as a Tailwind arbitrary value. (Examples stay out of these comments: Tailwind scans
// every file, so a sample class here would end up in the compiled CSS.)
const NAMED_COLOR_ARBITRARY = /-\[([a-z]+)\]/gi;

/** Named colours (other than white) assigned to a colour property or a Tailwind class. */
export function namedColorOffenders(text: string): string[] {
  return [...text.matchAll(NAMED_COLOR_ASSIGNMENT), ...text.matchAll(NAMED_COLOR_ARBITRARY)]
    .filter((m) => NAMED_COLORS.has(m[1]!.toLowerCase()))
    .map((m) => m[0]);
}

// Properties whose identifiers are names, not colours (font families, keyframes, ...).
const NAME_PROPERTY = /^(?:font|animat|transition|content|grid|container|counter|will-change)/i;
const DECLARATION = /[{;]\s*(-{0,2}[a-z][\w-]*)\s*:([^;{}]*)(?=[;}])/gi;

/**
 * Offending colours in a stylesheet's declarations, as `property: colour`. Selectors and
 * at-rule preludes (`@supports (color: ...)`) are skipped: they do not paint.
 */
export function cssColorOffenders(css: string): string[] {
  const offenders: string[] = [];
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, property = "", raw = ""] of code.matchAll(DECLARATION)) {
    const value = raw.replace(/url\([^)]*\)|"[^"]*"|'[^']*'/g, "");
    const found = colorOffenders(value);
    // Custom properties for fonts and animations hold names too (`--default-font-family`).
    const name = property.replace(/^--(?:tw-|default-(?:mono-)?)?/, "");
    if (!NAME_PROPERTY.test(name)) {
      for (const [word] of value.matchAll(/(?<![\w-])[a-z]+(?![\w(-])/gi)) {
        if (NAMED_COLORS.has(word.toLowerCase())) found.push(word);
      }
    }
    offenders.push(...found.map((color) => `${property}: ${color}`));
  }
  return offenders;
}

/**
 * Utilities that use Tailwind's default palette (a family such as gray or emerald plus a
 * 50–950 step). Families come from Tailwind's own theme so a new release cannot slip one in.
 */
export function tailwindPaletteClasses(text: string, families: readonly string[]): string[] {
  if (families.length === 0) return [];
  const pattern = new RegExp(
    `(?<![\\w-])(?:[\\w-]+-)?(?:${families.join("|")})-(?:50|[1-9]00|950)(?![\\w-])`,
    "g",
  );
  return [...text.matchAll(pattern)].map((m) => m[0]);
}
