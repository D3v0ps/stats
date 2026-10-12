import { describe, expect, it } from "vitest";
import type { Step } from "@/lib/contracts";
import {
  canRedo,
  canUndo,
  createHistory,
  historyShortcut,
  pushHistory,
  redo,
  resetHistory,
  undo,
} from "./undo";

const s1: Step[] = [{ op: "drop", column: "personnummer" }];
const s2: Step[] = [...s1, { op: "fill_down", column: "kund" }];
const s3: Step[] = [...s2, { op: "negate", column: "belopp" }];

describe("undo/redo history over step lists", () => {
  it("undoes and redoes in order", () => {
    let h = createHistory<Step[]>([]);
    expect(canUndo(h)).toBe(false);
    h = pushHistory(h, s1);
    h = pushHistory(h, s2);
    h = pushHistory(h, s3);
    expect(h.present).toBe(s3);
    h = undo(h);
    expect(h.present).toBe(s2);
    h = undo(h);
    expect(h.present).toBe(s1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(s2);
    h = redo(h);
    expect(h.present).toBe(s3);
    expect(canRedo(h)).toBe(false);
  });

  it("clears redo when a new change is made", () => {
    let h = pushHistory(pushHistory(createHistory<Step[]>([]), s1), s2);
    h = undo(h);
    h = pushHistory(h, s3);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([[], s1]);
  });

  it("ignores no-op pushes and undo/redo at the ends", () => {
    const h = createHistory<Step[]>(s1);
    expect(pushHistory(h, s1)).toBe(h);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("keeps at most the limit of snapshots", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i, 3);
    expect(h.past).toEqual([7, 8, 9]);
    expect(h.present).toBe(10);
  });

  it("resets to the original as an undoable step", () => {
    let h = pushHistory(pushHistory(createHistory<Step[]>([]), s1), s2);
    const original: Step[] = [];
    h = resetHistory(h, original);
    expect(h.present).toBe(original);
    h = undo(h);
    expect(h.present).toBe(s2);
  });
});

describe("historyShortcut", () => {
  const ev = (key: string, mods: Partial<Record<"ctrl" | "meta" | "shift" | "alt", boolean>>) => ({
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  });

  it("maps Ctrl/Cmd+Z, Shift and Y", () => {
    expect(historyShortcut(ev("z", { ctrl: true }))).toBe("undo");
    expect(historyShortcut(ev("Z", { meta: true }))).toBe("undo");
    expect(historyShortcut(ev("z", { meta: true, shift: true }))).toBe("redo");
    expect(historyShortcut(ev("y", { ctrl: true }))).toBe("redo");
  });

  it("ignores plain keys and other combinations", () => {
    expect(historyShortcut(ev("z", {}))).toBeNull();
    expect(historyShortcut(ev("z", { ctrl: true, alt: true }))).toBeNull();
    expect(historyShortcut(ev("s", { ctrl: true }))).toBeNull();
  });
});
