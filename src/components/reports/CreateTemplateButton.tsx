"use client";

import { FilePlus2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createBlankTemplateAction,
  createDefaultTemplateAction,
} from "@/app/(app)/rapporter/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "./FormMessage";

export interface CreateTemplateButtonProps {
  /** "standard": the default board report; "blank": a report with one slide, opened in the editor. */
  kind: "standard" | "blank";
  variant?: "default" | "outline";
}

export function CreateTemplateButton({ kind, variant = "default" }: CreateTemplateButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () => {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "standard"
          ? await createDefaultTemplateAction()
          : await createBlankTemplateAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The standard report appears in the list (the action revalidates /rapporter); a blank
      // report is only useful once it has been edited.
      if (kind === "blank") router.push(`/rapporter/${result.data.id}`);
    });
  };

  const Icon = kind === "standard" ? Sparkles : FilePlus2;
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size="lg"
        onClick={create}
        disabled={pending}
        className="gap-2"
        data-testid={kind === "standard" ? "create-default-report" : "create-blank-report"}
      >
        <Icon aria-hidden="true" />
        {pending ? "Skapar …" : kind === "standard" ? "Skapa standardrapport" : "Ny rapport"}
      </Button>
      {error ? <FormMessage>{error}</FormMessage> : null}
    </div>
  );
}
