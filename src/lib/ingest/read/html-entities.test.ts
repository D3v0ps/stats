import { describe, expect, it } from "vitest";
import { decodeCharacterReferences } from "./html-entities";

describe("decodeCharacterReferences", () => {
  it("decodes the named references of Swedish and Latin-1 letters", () => {
    expect(decodeCharacterReferences("S&ouml;dert&auml;lje &Aring;rsta &Eacute;lise")).toBe(
      "Södertälje Årsta Élise",
    );
    expect(decodeCharacterReferences("&aring;&auml;&ouml;&Aring;&Auml;&Ouml;&uuml;&eacute;")).toBe(
      "åäöÅÄÖüé",
    );
  });

  it("is case-sensitive like HTML: &Aring; and &aring; differ, &AUML; is no reference", () => {
    expect(decodeCharacterReferences("&Aring; &aring; &AUML;")).toBe("Å å &AUML;");
  });

  it("decodes decimal and hexadecimal references", () => {
    expect(decodeCharacterReferences("&#246; &#xF6; &#XE5; &#8364; &#x1F600;")).toBe("ö ö å € 😀");
  });

  it("decodes punctuation from Windows-1252 exports", () => {
    expect(decodeCharacterReferences("A&ndash;B &euro;5 &hellip; &rdquo;x&rdquo;")).toBe(
      "A–B €5 … ”x”",
    );
    // Numeric references in 0x80–0x9F mean the Windows-1252 character, as in browsers.
    expect(decodeCharacterReferences("&#150; &#128; &#133;")).toBe("– € …");
  });

  it("replaces references to nothing, surrogates and out-of-range code points", () => {
    expect(decodeCharacterReferences("&#0;&#xD800;&#x110000;")).toBe("���");
  });

  it("keeps markup characters escaped so the document keeps its structure", () => {
    expect(decodeCharacterReferences("&#60;td&#62; &#38; &#34; &#39; &lt; &amp;")).toBe(
      "&lt;td&gt; &amp; &quot; &apos; &lt; &amp;",
    );
  });

  it("leaves no-break spaces for SheetJS, which reads them as spaces", () => {
    expect(decodeCharacterReferences("a&nbsp;b&#160;c")).toBe("a&nbsp;b&nbsp;c");
  });

  it("decodes each reference once", () => {
    expect(decodeCharacterReferences("&amp;ouml; &amp;#246;")).toBe("&amp;ouml; &amp;#246;");
  });

  it("leaves unknown names and text that only resembles a reference", () => {
    expect(decodeCharacterReferences("AT&T &foo; &ouml &#; &#x; a & b")).toBe(
      "AT&T &foo; &ouml &#; &#x; a & b",
    );
  });
});
