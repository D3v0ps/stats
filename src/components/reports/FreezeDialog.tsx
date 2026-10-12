"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { freezeReportAction } from "@/app/(app)/rapporter/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FREEZE_TITLE_MAX, freezeInputError, type MonthOption } from "@/lib/present/freeze";
import { FormMessage } from "./FormMessage";

export interface FreezeDialogProps {
  templateId: string;
  /** "Styrelsemöte v.42" */
  defaultTitle: string;
  months: MonthOption[];
  defaultMonth: string;
  /** Why freezing is not possible right now (e.g. unsaved changes); shown in the dialog. */
  blockedReason?: string | null;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
}

/**
 * "Frys rapport": title and month, then the server resolves and stores an immutable
 * snapshot. Opens the archived report afterwards.
 */
export function FreezeDialog({
  templateId,
  defaultTitle,
  months,
  defaultMonth,
  blockedReason,
  triggerVariant = "outline",
}: FreezeDialogProps) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [month, setMonth] = useState(defaultMonth);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = { templateId, title, month };
    const invalid = freezeInputError(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    startTransition(async () => {
      const result = await freezeReportAction(input);
      if (result.ok) {
        setOpen(false);
        router.push(`/rapporter/arkiv/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="lg" className="gap-2" data-testid="freeze-open">
          <Lock aria-hidden="true" />
          Frys rapport
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle className="text-base font-medium tracking-[0.08em] uppercase">
              Frys rapport
            </DialogTitle>
            <DialogDescription>
              Siffrorna låses som de ser ut nu. En fryst rapport ändras aldrig, inte ens när ny data
              laddas upp.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${ids}-title`}>Titel</Label>
            <Input
              id={`${ids}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={FREEZE_TITLE_MAX}
              required
              autoComplete="off"
              data-testid="freeze-title"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${ids}-month`}>Månad</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger id={`${ids}-month`} className="w-full" data-testid="freeze-month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {blockedReason ? <FormMessage>{blockedReason}</FormMessage> : null}
          {error ? <FormMessage>{error}</FormMessage> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg">
                Avbryt
              </Button>
            </DialogClose>
            <Button
              type="submit"
              size="lg"
              disabled={pending || Boolean(blockedReason)}
              data-testid="freeze-submit"
            >
              {pending ? "Fryser …" : "Frys rapport"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
