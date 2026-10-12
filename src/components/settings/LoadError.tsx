import { CloudOff } from "lucide-react";
import { EmptyState } from "@/components/brand/EmptyState";

/** Shown in a settings section when its data could not be read. */
export function LoadError({ message }: { message: string }) {
  return (
    <EmptyState
      icon={<CloudOff />}
      title="Kunde inte läsa inställningarna"
      description={`${message} Ladda om sidan för att försöka igen.`}
    />
  );
}
