"use client";

import { useEffect } from "react";
import { LEAVE_UNSAVED_MESSAGE, linkLeavesPage } from "@/lib/present/leave-guard";

/**
 * While `active`, asks before unsaved changes are lost: the browser's prompt on reload or
 * close, and a confirm for in-app link clicks (client-side navigation never fires
 * beforeunload). The capture listener runs before next/link and cancels its navigation.
 */
export function useLeaveGuard(active: boolean, message: string = LEAVE_UNSAVED_MESSAGE) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const leaves = linkLeavesPage(
        {
          href: anchor.getAttribute("href") ?? "",
          target: anchor.getAttribute("target"),
          download: anchor.hasAttribute("download"),
          button: event.button,
          modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
          defaultPrevented: event.defaultPrevented,
        },
        window.location,
      );
      if (leaves && !window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}
