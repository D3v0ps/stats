"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import {
  deckReducer,
  keyBelongsToTarget,
  keyToCommand,
  withSlideParam,
  type DeckAction,
  type DeckCommand,
} from "@/lib/present/deck-nav";
import { useDeckSync } from "./use-deck-sync";

export interface DeckNavigationOptions {
  deckKey: string;
  count: number;
  initialIndex: number;
  /** Mirror the slide number in the URL (?bild=3) so a reload keeps the position. */
  syncUrl?: boolean;
  /** Fullscreen commands (F / Escape); navigation is handled here. */
  onCommand?: (command: Exclude<DeckCommand, DeckAction>) => void;
}

function writeSlideToUrl(index: number) {
  const search = withSlideParam(window.location.search, index);
  // Native history calls integrate with the Next.js router (no navigation, no refetch).
  window.history.replaceState(null, "", `${window.location.pathname}${search}`);
}

/**
 * Current slide of a deck or notes window: keyboard (incl. presenter clickers), local moves
 * and moves made in the other window via BroadcastChannel.
 */
export function useDeckNavigation({
  deckKey,
  count,
  initialIndex,
  syncUrl = false,
  onCommand,
}: DeckNavigationOptions) {
  const [index, setIndex] = useState(initialIndex);

  const show = useCallback(
    (next: number) => {
      setIndex(next);
      if (syncUrl) writeSlideToUrl(next);
    },
    [syncUrl],
  );

  const publish = useDeckSync({ deckKey, count, index, onRemoteIndex: show });

  const move = useCallback(
    (action: DeckAction) => {
      const next = deckReducer({ index, count }, action).index;
      if (next === index) return;
      show(next);
      publish(next);
    },
    [index, count, show, publish],
  );

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      keyBelongsToTarget(
        target && {
          tagName: target.tagName,
          isContentEditable: target.isContentEditable,
          role: target.getAttribute("role"),
        },
        event.key,
      )
    ) {
      return;
    }
    const command = keyToCommand(event);
    if (!command) return;
    if (command.type === "toggleFullscreen" || command.type === "exitFullscreen") {
      if (!onCommand) return;
      event.preventDefault();
      onCommand(command);
      return;
    }
    event.preventDefault();
    move(command);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return { index, move };
}
