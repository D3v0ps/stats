// Deck <-> speaker notes window sync over BroadcastChannel (same browser, same origin).
// Either window can move the slide; both follow. Messages from the channel are untrusted
// input and validated before use.
import { z } from "zod";

const CHANNEL_PREFIX = "mb-stats-deck:";

const SenderSchema = z.string().min(1).max(64);
const IndexSchema = z.number().int().min(0).max(9999);

export const SyncMessageSchema = z.discriminatedUnion("type", [
  /** Move to a slide. */
  z.object({ type: z.literal("goto"), sender: SenderSchema, index: IndexSchema }),
  /** A window just opened and asks where the deck is. */
  z.object({ type: z.literal("hello"), sender: SenderSchema }),
  /** Answer to hello: the current slide. */
  z.object({ type: z.literal("state"), sender: SenderSchema, index: IndexSchema }),
]);
export type SyncMessage = z.infer<typeof SyncMessageSchema>;

/** Live deck for a template at an anchor month. */
export function templateDeckKey(templateId: string, anchorMonth: string): string {
  return `t:${templateId}:${anchorMonth}`;
}

/** Frozen report deck. */
export function frozenDeckKey(reportId: string): string {
  return `a:${reportId}`;
}

export function syncChannelName(deckKey: string): string {
  return `${CHANNEL_PREFIX}${deckKey}`;
}

export function parseSyncMessage(data: unknown): SyncMessage | null {
  const parsed = SyncMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * The slide index a window should move to after a message, or null when the message
 * changes nothing (its own echo, a hello, or an index outside this deck).
 */
export function indexFromMessage(
  message: SyncMessage,
  selfId: string,
  count: number,
): number | null {
  if (message.sender === selfId || message.type === "hello") return null;
  return message.index < count ? message.index : null;
}

/** Random-enough window id; only used to ignore a window's own messages. */
export function newSenderId(random: () => number = Math.random): string {
  return `w${Math.floor(random() * 1e12).toString(36)}${Date.now().toString(36)}`;
}
