import { describe, expect, it } from "vitest";
import {
  frozenDeckKey,
  indexFromMessage,
  newSenderId,
  parseSyncMessage,
  syncChannelName,
  templateDeckKey,
} from "./sync";

describe("channel names", () => {
  it("separate live decks per month and frozen reports", () => {
    const live = syncChannelName(templateDeckKey("t-1", "2026-09"));
    expect(live).toBe("mb-stats-deck:t:t-1:2026-09");
    expect(syncChannelName(templateDeckKey("t-1", "2026-08"))).not.toBe(live);
    expect(syncChannelName(frozenDeckKey("r-1"))).toBe("mb-stats-deck:a:r-1");
  });
});

describe("parseSyncMessage", () => {
  it("accepts the three message types", () => {
    expect(parseSyncMessage({ type: "goto", sender: "a", index: 3 })).toEqual({
      type: "goto",
      sender: "a",
      index: 3,
    });
    expect(parseSyncMessage({ type: "hello", sender: "b" })).toEqual({
      type: "hello",
      sender: "b",
    });
    expect(parseSyncMessage({ type: "state", sender: "c", index: 0 })).toEqual({
      type: "state",
      sender: "c",
      index: 0,
    });
  });

  it("rejects anything else", () => {
    expect(parseSyncMessage(null)).toBeNull();
    expect(parseSyncMessage("goto")).toBeNull();
    expect(parseSyncMessage({ type: "goto", sender: "a", index: -1 })).toBeNull();
    expect(parseSyncMessage({ type: "goto", sender: "a", index: 1.5 })).toBeNull();
    expect(parseSyncMessage({ type: "goto", sender: "", index: 1 })).toBeNull();
    expect(parseSyncMessage({ type: "reload", sender: "a" })).toBeNull();
  });
});

describe("indexFromMessage", () => {
  it("follows other windows and ignores its own echo and hellos", () => {
    expect(indexFromMessage({ type: "goto", sender: "other", index: 2 }, "me", 5)).toBe(2);
    expect(indexFromMessage({ type: "state", sender: "other", index: 4 }, "me", 5)).toBe(4);
    expect(indexFromMessage({ type: "goto", sender: "me", index: 2 }, "me", 5)).toBeNull();
    expect(indexFromMessage({ type: "hello", sender: "other" }, "me", 5)).toBeNull();
  });

  it("ignores indexes outside this deck", () => {
    expect(indexFromMessage({ type: "goto", sender: "other", index: 5 }, "me", 5)).toBeNull();
  });
});

describe("newSenderId", () => {
  it("gives distinct ids for distinct random draws", () => {
    expect(newSenderId(() => 0.1)).not.toBe(newSenderId(() => 0.2));
    expect(newSenderId().length).toBeGreaterThan(2);
  });
});
