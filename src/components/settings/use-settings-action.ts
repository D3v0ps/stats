"use client";

// Runs a settings server action in a transition and reports the result as a Swedish toast.
// `optimistic` runs inside the same transition, so useOptimistic state reverts by itself when
// the action fails and is replaced by fresh server data when it succeeds.
import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/settings-ui/action-result";

export const NETWORK_ERROR = "Kunde inte nå servern. Kontrollera anslutningen och försök igen.";

export interface RunOptions<T> {
  optimistic?: () => void;
  onSuccess?: (data: T) => void;
  onError?: (message: string) => void;
}

export function useSettingsAction() {
  const [pending, startTransition] = useTransition();

  function run<I, T>(
    action: (input: I) => Promise<ActionResult<T>>,
    input: I,
    opts: RunOptions<T> = {},
  ): void {
    startTransition(async () => {
      opts.optimistic?.();
      let result: ActionResult<T>;
      try {
        result = await action(input);
      } catch {
        toast.error(NETWORK_ERROR);
        opts.onError?.(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        toast.success(result.message);
        opts.onSuccess?.(result.data);
      } else {
        toast.error(result.error);
        opts.onError?.(result.error);
      }
    });
  }

  return { pending, run };
}
