import "server-only";

// Reads for the settings pages through the signed-in user's client. A failed read renders a
// Swedish error state in the section instead of crashing the whole page.
import { unstable_rethrow } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import type { DbClient } from "@/lib/db/repo/shared";
import { errorMessage } from "@/lib/settings-ui/action-result";

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export async function load<T>(read: (db: DbClient) => Promise<T>): Promise<Loaded<T>> {
  try {
    const db = await createSupabaseServerClient();
    return { ok: true, data: await read(db) };
  } catch (error) {
    unstable_rethrow(error);
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`[settings] read failed (${typeof code === "string" ? code : "error"})`);
    return { ok: false, error: errorMessage(error) };
  }
}
