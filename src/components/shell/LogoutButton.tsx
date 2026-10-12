import { LogOut } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import { NAV_ROW } from "./nav-items";

/** "Logga ut" for the sidebar: signs out this browser only (logoutEverywhere signs out all). */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logout} className={className}>
      <button type="submit" className={NAV_ROW}>
        <LogOut aria-hidden="true" className="size-4 shrink-0" />
        Logga ut
      </button>
    </form>
  );
}
