import type { Metadata } from "next";
import { Section } from "@/components/brand/Section";
import { LogoutEverywhere } from "@/components/settings/LogoutEverywhere";
import { PasswordForm } from "@/components/settings/PasswordForm";
import { requireSession } from "@/lib/db/session";
import { sectionBySlug } from "@/lib/settings-ui/sections";

const section = sectionBySlug("sakerhet");

export const metadata: Metadata = { title: `${section.label} – Inställningar` };

export default async function SecuritySettingsPage() {
  await requireSession();
  return (
    <div className="flex flex-col gap-10">
      <Section
        title="Byt lösenord"
        description="MB Stats har ett gemensamt lösenord. När du byter det måste alla som loggar in använda det nya lösenordet."
      >
        <PasswordForm />
      </Section>
      <Section
        title="Logga ut alla enheter"
        description="Loggar ut alla webbläsare och enheter som är inloggade, även den här. Använd det efter ett lösenordsbyte eller om en enhet har kommit bort."
      >
        <LogoutEverywhere />
      </Section>
    </div>
  );
}
