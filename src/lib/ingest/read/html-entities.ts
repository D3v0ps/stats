// Character references in HTML tables saved as ".xls". SheetJS decodes only amp, lt, gt,
// quot, apos, nbsp and middot, so "S&ouml;dert&auml;lje" and "&#246;" would reach the
// mapping view as written. Pure TS: there is no DOM parser to lean on in the worker.
import { CP1252_HIGH } from "@/lib/core/encoding";

// ISO-8859-1 names in code point order, U+00A0 to U+00FF.
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg " +
  "plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute " +
  "Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml " +
  "Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc " +
  "euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash " +
  "ugrave uacute ucirc uuml yacute thorn yuml";

const NAMED: ReadonlyMap<string, string> = new Map([
  ...LATIN1.split(" ").map((name, i) => [name, String.fromCharCode(0xa0 + i)] as const),
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  // The rest of Windows-1252 (0x80–0x9F), which Swedish exports also write as references.
  ["euro", "€"],
  ["sbquo", "‚"],
  ["fnof", "ƒ"],
  ["bdquo", "„"],
  ["hellip", "…"],
  ["dagger", "†"],
  ["Dagger", "‡"],
  ["circ", "ˆ"],
  ["permil", "‰"],
  ["Scaron", "Š"],
  ["lsaquo", "‹"],
  ["OElig", "Œ"],
  ["Zcaron", "Ž"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["bull", "•"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["tilde", "˜"],
  ["trade", "™"],
  ["scaron", "š"],
  ["rsaquo", "›"],
  ["oelig", "œ"],
  ["zcaron", "ž"],
  ["Yuml", "Ÿ"],
  // Not in Windows-1252: the minus sign and HTML 4's spacing and format characters.
  ["minus", "−"],
  ["ensp", "\u2002"],
  ["emsp", "\u2003"],
  ["thinsp", "\u2009"],
  ["zwnj", "\u200c"],
  ["zwj", "\u200d"],
  ["lrm", "\u200e"],
  ["rlm", "\u200f"],
]);

// References to direction marks and embeddings are dropped, not decoded. They carry no text,
// only display direction, yet a header written "Kund&lrm;" would get a signature that
// silently differs from the "kund" on screen. normalizeHeader is not the place to strip
// them: its output is a stored key.
const BIDI_CONTROL = /^\p{Bidi_Control}$/u;

// What SheetJS decodes itself stays escaped: the markup characters, whose decoding would
// change the document's structure, and the no-break space, which SheetJS reads as a space.
const LEAVE_ESCAPED: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&apos;"],
  [" ", "&nbsp;"],
]);

const REFERENCE = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([A-Za-z][A-Za-z0-9]*));/g;

/** The character a numeric reference stands for, as HTML parsers read it. */
function fromCodePoint(cp: number): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
  if (cp >= 0x80 && cp < 0xa0) return String.fromCharCode(CP1252_HIGH[cp - 0x80]!);
  return String.fromCodePoint(cp);
}

/**
 * Decode the named (Latin-1 and Windows-1252) and numeric character references of an HTML
 * document before SheetJS parses it. Unknown names and references without the closing ";"
 * stay as written, every reference is decoded once ("&amp;ouml;" stays literal text) and
 * references to direction marks are removed.
 */
export function decodeCharacterReferences(html: string): string {
  return html.replace(REFERENCE, (ref, hex?: string, dec?: string, name?: string) => {
    const char =
      name !== undefined
        ? NAMED.get(name)
        : fromCodePoint(hex !== undefined ? parseInt(hex, 16) : Number(dec));
    if (char === undefined) return ref;
    if (BIDI_CONTROL.test(char)) return "";
    return LEAVE_ESCAPED.get(char) ?? char;
  });
}
