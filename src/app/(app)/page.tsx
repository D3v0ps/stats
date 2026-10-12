import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/brand/EmptyState";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/db/session";

// Placeholder until the dashboard (module H) lands.
export default async function OverviewPage() {
  await requireSession();
  return (
    <>
      <PageHeader
        title="Översikt"
        description="Nyckeltal för Miljonbemanning AB och Miljonbemanning Restart AB."
      />
      <EmptyState
        icon={<LayoutDashboard />}
        title="Inga nyckeltal ännu"
        description="När den första filen är uppladdad och publicerad visas nyckeltalen här."
        action={
          <Button asChild>
            <Link href="/ladda-upp">Ladda upp en fil</Link>
          </Button>
        }
      />
    </>
  );
}
