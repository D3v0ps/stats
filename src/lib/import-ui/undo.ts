// Undo/redo for the mapping view. Steps are pure, so the whole mapping (step
// list included) is kept as immutable snapshots: undo restores the previous
// snapshot and the preview is simply recomputed from the original file.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** Snapshots kept for undo; older ones are forgotten. */
export const HISTORY_LIMIT = 200;

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] };
}

/** Record a new state. A no-op change (same object) adds nothing; redo is cleared. */
export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
  };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1] as T;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future as [T, ...T[]];
  return { past: [...h.past, h.present], present: next, future: rest };
}

/**
 * "Återställ till originalfilen": go back to the original state as a new,
 * undoable step (the user can change their mind with Ctrl+Z).
 */
export function resetHistory<T>(h: History<T>, original: T): History<T> {
  return pushHistory(h, original);
}

/** Keyboard shortcut for undo/redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. */
export function historyShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !e.shiftKey) return "redo";
  return null;
}
