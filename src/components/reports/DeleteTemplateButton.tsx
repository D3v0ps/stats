"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTemplateAction } from "@/app/(app)/rapporter/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FormMessage } from "./FormMessage";

/** Deletes a template after confirmation. Frozen reports made from it are kept. */
export function DeleteTemplateButton({ templateId, name }: { templateId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const result = await deleteTemplateAction(templateId);
      if (result.ok) router.push("/rapporter");
      else setError(result.error);
    });
  };

  return (
    <AlertDialog onOpenChange={(open) => open && setError(null)}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="gap-2"
          data-testid="editor-delete"
        >
          <Trash2 aria-hidden="true" />
          Ta bort
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ta bort {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Mallen tas bort. Frysta rapporter som gjorts från den finns kvar i arkivet.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Avbryt</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              remove();
            }}
            disabled={pending}
          >
            {pending ? "Tar bort …" : "Ta bort"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
