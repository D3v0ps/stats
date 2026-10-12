"use client";

import { LogOut } from "lucide-react";
import { useRef } from "react";
import { logoutEverywhere } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsCard } from "./ui";

/** Confirms, then submits the existing logoutEverywhere server action (it redirects to login). */
export function LogoutEverywhere() {
  const form = useRef<HTMLFormElement>(null);
  return (
    <SettingsCard className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Andra enheter loggas ut senast inom en timme, när deras inloggning ska förnyas.
      </p>
      <form ref={form} action={logoutEverywhere}>
        <ConfirmDialog
          trigger={
            <Button type="button" variant="outline" data-testid="logout-everywhere">
              <LogOut aria-hidden="true" />
              Logga ut alla enheter
            </Button>
          }
          title="Logga ut alla enheter?"
          description={
            <p>Alla enheter loggas ut, även den här. Du kommer till inloggningssidan.</p>
          }
          confirmLabel="Logga ut alla"
          onConfirm={() => form.current?.requestSubmit()}
          testId="logout-everywhere-dialog"
        />
      </form>
    </SettingsCard>
  );
}
