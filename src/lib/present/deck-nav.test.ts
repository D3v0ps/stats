import { describe, expect, it } from "vitest";
import {
  clampIndex,
  deckReducer,
  keyBelongsToTarget,
  keyToCommand,
  parseSlideNumber,
  tapAction,
  withSlideParam,
  type DeckState,
} from "./deck-nav";

const at = (index: number, count = 5): DeckState => ({ index, count });

describe("deckReducer", () => {
  it("moves one slide at a time and stops at the ends", () => {
    expect(deckReducer(at(0), { type: "next" })).toEqual(at(1));
    expect(deckReducer(at(4), { type: "next" })).toEqual(at(4));
    expect(deckReducer(at(2), { type: "prev" })).toEqual(at(1));
    expect(deckReducer(at(0), { type: "prev" })).toEqual(at(0));
  });

  it("jumps to the first, the last and a given slide", () => {
    expect(deckReducer(at(3), { type: "first" })).toEqual(at(0));
    expect(deckReducer(at(1), { type: "last" })).toEqual(at(4));
    expect(deckReducer(at(1), { type: "goto", index: 3 })).toEqual(at(3));
    expect(deckReducer(at(1), { type: "goto", index: 99 })).toEqual(at(4));
    expect(deckReducer(at(1), { type: "goto", index: -2 })).toEqual(at(0));
  });

  it("returns the same state object when nothing changes", () => {
    const state = at(4);
    expect(deckReducer(state, { type: "next" })).toBe(state);
  });

  it("handles an empty deck", () => {
    expect(deckReducer(at(0, 0), { type: "next" })).toEqual(at(0, 0));
    expect(clampIndex(3, 0)).toBe(0);
    expect(clampIndex(Number.NaN, 4)).toBe(0);
  });
});

describe("keyToCommand", () => {
  it("maps arrows, space, presenter clicker keys, Home and End", () => {
    expect(keyToCommand({ key: "ArrowRight" })).toEqual({ type: "next" });
    expect(keyToCommand({ key: " " })).toEqual({ type: "next" });
    expect(keyToCommand({ key: "PageDown" })).toEqual({ type: "next" });
    expect(keyToCommand({ key: "ArrowLeft" })).toEqual({ type: "prev" });
    expect(keyToCommand({ key: "PageUp" })).toEqual({ type: "prev" });
    expect(keyToCommand({ key: " ", shiftKey: true })).toEqual({ type: "prev" });
    expect(keyToCommand({ key: "Home" })).toEqual({ type: "first" });
    expect(keyToCommand({ key: "End" })).toEqual({ type: "last" });
  });

  it("toggles fullscreen with F and leaves it with Escape", () => {
    expect(keyToCommand({ key: "f" })).toEqual({ type: "toggleFullscreen" });
    expect(keyToCommand({ key: "F", shiftKey: true })).toEqual({ type: "toggleFullscreen" });
    expect(keyToCommand({ key: "Escape" })).toEqual({ type: "exitFullscreen" });
  });

  it("leaves modified keys and unrelated keys to the browser", () => {
    expect(keyToCommand({ key: "f", ctrlKey: true })).toBeNull();
    expect(keyToCommand({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(keyToCommand({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(keyToCommand({ key: "ArrowDown" })).toBeNull();
    expect(keyToCommand({ key: "a" })).toBeNull();
  });
});

describe("keyBelongsToTarget", () => {
  it("leaves typing in fields alone", () => {
    expect(keyBelongsToTarget({ tagName: "input" }, "ArrowRight")).toBe(true);
    expect(keyBelongsToTarget({ tagName: "TEXTAREA" }, " ")).toBe(true);
    expect(keyBelongsToTarget({ tagName: "DIV", isContentEditable: true }, "End")).toBe(true);
  });

  it("lets Space and Enter press a focused button but arrows still navigate", () => {
    expect(keyBelongsToTarget({ tagName: "BUTTON" }, " ")).toBe(true);
    expect(keyBelongsToTarget({ tagName: "A" }, "Enter")).toBe(true);
    expect(keyBelongsToTarget({ tagName: "DIV", role: "button" }, " ")).toBe(true);
    expect(keyBelongsToTarget({ tagName: "BUTTON" }, "ArrowRight")).toBe(false);
  });

  it("gives everything else to the deck", () => {
    expect(keyBelongsToTarget({ tagName: "DIV" }, " ")).toBe(false);
    expect(keyBelongsToTarget({ tagName: "BODY" }, "PageDown")).toBe(false);
    expect(keyBelongsToTarget(null, " ")).toBe(false);
  });
});

describe("tapAction", () => {
  it("goes back on the left half and forward on the right half", () => {
    expect(tapAction(100, 1000)).toEqual({ type: "prev" });
    expect(tapAction(499, 1000)).toEqual({ type: "prev" });
    expect(tapAction(500, 1000)).toEqual({ type: "next" });
    expect(tapAction(980, 1000)).toEqual({ type: "next" });
    expect(tapAction(0, 0)).toEqual({ type: "next" });
  });
});

describe("slide number in the URL", () => {
  it("parses 1-based slide numbers", () => {
    expect(parseSlideNumber("3", 5)).toBe(2);
    expect(parseSlideNumber("#4", 5)).toBe(3);
    expect(parseSlideNumber(["2", "4"], 5)).toBe(1);
  });

  it("ignores missing, malformed and out-of-range numbers", () => {
    expect(parseSlideNumber(undefined, 5)).toBeNull();
    expect(parseSlideNumber("", 5)).toBeNull();
    expect(parseSlideNumber("0", 5)).toBeNull();
    expect(parseSlideNumber("6", 5)).toBeNull();
    expect(parseSlideNumber("abc", 5)).toBeNull();
    expect(parseSlideNumber("1", 0)).toBeNull();
  });

  it("writes the number and keeps other parameters", () => {
    expect(withSlideParam("?manad=2026-09", 2)).toBe("?manad=2026-09&bild=3");
    expect(withSlideParam("?manad=2026-09&bild=3", 0)).toBe("?manad=2026-09");
    expect(withSlideParam("", 0)).toBe("");
    expect(withSlideParam("?bild=2", 4)).toBe("?bild=5");
  });
});
