// Navigation in the presentation deck and the speaker notes window: one slide at a time,
// driven by keyboard (incl. presenter clickers, which send PageUp/PageDown), taps on the
// left/right half of the slide and the progress dots.

export interface DeckState {
  /** 0-based index of the current slide. */
  index: number;
  count: number;
}

export type DeckAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "goto"; index: number };

export type DeckCommand = DeckAction | { type: "toggleFullscreen" } | { type: "exitFullscreen" };

export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

export function deckReducer(state: DeckState, action: DeckAction): DeckState {
  const target = (() => {
    switch (action.type) {
      case "next":
        return state.index + 1;
      case "prev":
        return state.index - 1;
      case "first":
        return 0;
      case "last":
        return state.count - 1;
      case "goto":
        return action.index;
    }
  })();
  const index = clampIndex(target, state.count);
  return index === state.index ? state : { ...state, index };
}

export interface KeyInput {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * The deck command for a key press, or null when the key is not ours. Keys with Ctrl,
 * Cmd or Alt are left to the browser (Ctrl+F must still find text).
 */
export function keyToCommand(input: KeyInput): DeckCommand | null {
  if (input.altKey || input.ctrlKey || input.metaKey) return null;
  switch (input.key) {
    case "ArrowRight":
    case "PageDown":
      return { type: "next" };
    case " ":
    case "Spacebar":
      return input.shiftKey ? { type: "prev" } : { type: "next" };
    case "ArrowLeft":
    case "PageUp":
      return { type: "prev" };
    case "Home":
      return { type: "first" };
    case "End":
      return { type: "last" };
    case "f":
    case "F":
      return { type: "toggleFullscreen" };
    case "Escape":
      return { type: "exitFullscreen" };
    default:
      return null;
  }
}

export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  role?: string | null;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const ACTIVATABLE_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);

/**
 * Whether a key press on this element belongs to the element, not the deck: typing in
 * fields, and Space/Enter on a focused button or link (it should press the button).
 */
export function keyBelongsToTarget(target: KeyTarget | null, key: string): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (EDITABLE_TAGS.has(tag) || target.isContentEditable) return true;
  const activatable = ACTIVATABLE_TAGS.has(tag) || target.role === "button";
  return activatable && (key === " " || key === "Spacebar" || key === "Enter");
}

/** A tap or click on the left half goes back, on the right half forward. */
export function tapAction(x: number, width: number): DeckAction {
  return width > 0 && x < width / 2 ? { type: "prev" } : { type: "next" };
}

/** URL parameter holding the 1-based slide number, so a reload keeps the position. */
export const SLIDE_PARAM = "bild";

/** The slide index in a 1-based slide number ("3" -> 2), or null when absent or out of range. */
export function parseSlideNumber(
  value: string | string[] | null | undefined,
  count: number,
): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string") return null;
  const match = /^#?(\d{1,4})$/.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]) - 1;
  return n >= 0 && n < count ? n : null;
}

/** `search` with the slide number set ("?manad=2026-09&bild=3"); the first slide drops it. */
export function withSlideParam(search: string, index: number): string {
  const params = new URLSearchParams(search);
  if (index <= 0) params.delete(SLIDE_PARAM);
  else params.set(SLIDE_PARAM, String(index + 1));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
