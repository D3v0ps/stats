"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { deleteTemplateAction } from "@/app/(app)/installningar/actions";
import { Button } from "@/components/ui/button";
import { SETTINGS_BASE } from "@/lib/settings-ui/sections";
import { templateDeleteDescription } from "@/lib/settings-ui/template-delete";
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
          {templateDeleteDescription(name, uses).map((text) => (
            <p key={text}>{text}</p>
          ))}
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
