"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { deleteTemplateAction } from "@/app/(app)/installningar/actions";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/core/format-sv";
import { SETTINGS_BASE } from "@/lib/settings-ui/sections";
import { ConfirmDialog } from "./ConfirmDialog";
import { useSettingsAction } from "./use-settings-action";

export function TemplateDeleteButton({
  id,
  name,
  uses,
}: {
  id: string;
  name: string;
  uses: number;
}) {
  const router = useRouter();
  const { pending, run } = useSettingsAction();

  if (uses > 0) {
    return (
      <p className="max-w-xs text-xs text-muted-foreground" data-testid="template-delete-blocked">
        Mallen används av {formatNumber(uses)} {uses === 1 ? "uppladdning" : "uppladdningar"} och
        kan därför inte tas bort.
      </p>
    );
  }

  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" disabled={pending} data-testid="template-delete">
          <Trash2 aria-hidden="true" />
          Ta bort mall
        </Button>
      }
      title="Ta bort mallen?"
      description={
        <>
          <p>
            ”{name}” och alla dess versioner tas bort. Filer av den här sorten känns inte längre
            igen automatiskt.
          </p>
          <p>Det går inte att ångra.</p>
        </>
      }
      confirmLabel="Ta bort"
      destructive
      onConfirm={() =>
        run(
          deleteTemplateAction,
          { id },
          { onSuccess: () => router.push(`${SETTINGS_BASE}/importmallar`) },
        )
      }
      testId="template-delete-dialog"
    />
  );
}
