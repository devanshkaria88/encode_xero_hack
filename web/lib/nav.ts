import {
  Inbox,
  Calendar,
  Users,
  FileText,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Match child routes too (e.g. /clients/123). */
  matchPrefix?: boolean;
}

/** The first-class surfaces. Tasks inbox is home; Settings sits last. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Tasks inbox", href: "/", icon: Inbox },
  { label: "Calendar", href: "/calendar", icon: Calendar, matchPrefix: true },
  { label: "Clients", href: "/clients", icon: Users, matchPrefix: true },
  { label: "Invoices", href: "/invoices", icon: FileText, matchPrefix: true },
  {
    label: "Connections",
    href: "/connections",
    icon: Plug,
    matchPrefix: true,
  },
  { label: "Settings", href: "/settings", icon: Settings, matchPrefix: true },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return item.matchPrefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
}
