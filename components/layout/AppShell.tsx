"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Calendar,
  Clock,
  MessageCircle,
  Settings,
  Sun,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { NotificationsBell } from "./NotificationsBell";
import { GarminSyncIndicator } from "./GarminSyncIndicator";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/week", label: "Week", icon: Calendar },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/sensors", label: "Sensors", icon: Activity },
  { href: "/history", label: "History", icon: Clock },
  { href: "/coach", label: "Coach", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 lg:left-0 lg:border-r lg:bg-card z-10">
        <div className="px-6 py-5 border-b">
          <h1 className="text-lg font-bold tracking-tight">Project Ares</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Hybrid Training</p>
        </div>
        <nav className="flex flex-col gap-1 p-3 flex-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>
        <div className="px-3 py-3 border-t flex items-center justify-between gap-2">
          <GarminSyncIndicator />
          <NotificationsBell />
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <header className="lg:hidden flex items-center justify-between px-4 h-14 border-b bg-card sticky top-0 z-10">
        <h1 className="text-base font-bold">Project Ares</h1>
        <div className="flex items-center gap-2">
          <GarminSyncIndicator compact />
          <NotificationsBell />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 lg:ml-60 pb-20 lg:pb-6 min-w-0">{children}</main>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t bg-card z-10">
        <div className="grid grid-cols-7 h-16">
          {NAV_ITEMS.map((item) => (
            <BottomNavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { Icon } = { Icon: item.icon };
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

function BottomNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { Icon } = { Icon: item.icon };
  return (
    <Link
      href={item.href}
      className={`flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
        active ? "text-foreground font-semibold" : "text-muted-foreground"
      }`}
    >
      <Icon className="h-5 w-5" />
      <span>{item.label}</span>
    </Link>
  );
}
