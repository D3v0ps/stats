"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import {
  indexFromMessage,
  newSenderId,
  parseSyncMessage,
  syncChannelName,
  type SyncMessage,
} from "@/lib/present/sync";

export interface DeckSyncOptions {
  deckKey: string;
  count: number;
  /** The window's current slide (answered to windows that just opened). */
  index: number;
  /** Another window moved to this slide. */
  onRemoteIndex: (index: number) => void;
}

/**
 * Keeps the deck and the speaker notes window on the same slide via BroadcastChannel.
 * Returns `publish(index)` for local moves; remote moves arrive through onRemoteIndex and
 * are not re-published (no echo loops). Without BroadcastChannel it silently does nothing.
 */
export function useDeckSync({ deckKey, count, index, onRemoteIndex }: DeckSyncOptions) {
  const channelRef = useRef<{ channel: BroadcastChannel; sender: string } | null>(null);
  const currentIndex = useEffectEvent(() => index);
  const handleRemote = useEffectEvent((next: number) => onRemoteIndex(next));

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(syncChannelName(deckKey));
    const sender = newSenderId();
    channelRef.current = { channel, sender };
    const post = (message: SyncMessage) => channel.postMessage(message);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseSyncMessage(event.data);
      if (!message || message.sender === sender) return;
      if (message.type === "hello") {
        post({ type: "state", sender, index: currentIndex() });
        return;
      }
      const next = indexFromMessage(message, sender, count);
      if (next !== null) handleRemote(next);
    };
    post({ type: "hello", sender });
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [deckKey, count]);

  return useCallback((next: number) => {
    const current = channelRef.current;
    current?.channel.postMessage({ type: "goto", sender: current.sender, index: next });
  }, []);
}
