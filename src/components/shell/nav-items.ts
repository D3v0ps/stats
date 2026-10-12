import {
  ChartNoAxesCombined,
  FileText,
  LayoutDashboard,
  Settings,
  Upload,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Översikt", icon: LayoutDashboard },
  { href: "/utforska", label: "Utforska", icon: ChartNoAxesCombined },
  { href: "/ladda-upp", label: "Ladda upp", icon: Upload },
  { href: "/rapporter", label: "Rapporter", icon: FileText },
  { href: "/installningar", label: "Inställningar", icon: Settings },
];

/** Row style shared by nav links and the logout button in the antracit sidebar. */
export const NAV_ROW =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm tracking-[0.04em] text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none";

/** "/" is active only on the start page; other items also own their sub-pages. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
