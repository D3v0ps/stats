import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { logoutEverywhere } from "@/app/(auth)/actions";
import { EmptyState } from "@/components/brand/EmptyState";
import { Section } from "@/components/brand/Section";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Inställningar" };

// Placeholder until settings (module J) land. Keeps "log out everywhere" reachable meanwhile.
export default async function SettingsPage() {
  await requireSession();
  return (
    <div className="flex flex-col gap-12">
      <div>
        <PageHeader
          title="Inställningar"
          description="Mått, dimensioner, importmallar och perioder."
        />
        <EmptyState
          icon={<Settings />}
          title="Kommer snart"
          description="Här redigerar du katalogen: mått, verksamheter, kunder och mallar."
        />
      </div>
      <Section
        title="Säkerhet"
        level={2}
        description="Loggar ut alla webbläsare och enheter som är inloggade med lösenordet, även den här."
      >
        <form action={logoutEverywhere}>
          <Button type="submit" variant="outline">
            Logga ut överallt
          </Button>
        </form>
      </Section>
    </div>
  );
}
