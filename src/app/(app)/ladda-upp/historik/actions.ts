"use server";

// "Ångra publicering": retract an upload; the previous version of each month
// becomes current again. Nothing is deleted.
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { retractUpload } from "@/lib/db/repo";
import { requireSession } from "@/lib/db/session";
import type { ActionResult } from "@/lib/import-ui/action-schemas";
import { actionErrorMessage } from "@/lib/import-ui/errors";
import { RetractInputSchema, retractResultText } from "@/lib/import-ui/upload-history";

export async function retractUploadAction(input: {
  uploadId: string;
  reason: string;
}): Promise<ActionResult<string>> {
  await requireSession();
  const parsed = RetractInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Uppgifterna kunde inte tas emot.",
    };
  }
  try {
    const db = await createSupabaseServerClient();
    const result = await retractUpload(db, parsed.data.uploadId, parsed.data.reason);
    revalidatePath("/ladda-upp/historik");
    return { ok: true, data: retractResultText(result) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
