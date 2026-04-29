"use client";

// Sprint v0.11 (Direction C): sharp bottom navigation. No pill, no glass, no
// backdrop-blur, no Lucide icons — pure text labels with a 2px active-tab
// dash underneath. File name kept (legacy import path in AppShell) but the
// design replaces v0.8's floating-glass-pill.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Heute" },
  { href: "/week", label: "Plan" },
  { href: "/progress", label: "Stats" },
  { href: "/coach", label: "Coach" },
  { href: "/settings", label: "Settings" },
];

export function FloatingNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" role="navigation" aria-label="Hauptnavigation">
      <div className="flex items-center justify-around py-2">
        {NAV_ITEMS.map((tab) => {
          const active =
            pathname === tab.href || pathname?.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center gap-1 px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase transition-colors",
                active
                  ? "text-foreground"
                  : "text-foreground-muted hover:text-foreground-secondary",
              )}
            >
              {tab.label}
              {active && (
                <span className="h-[2px] w-4 rounded-full bg-foreground" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
