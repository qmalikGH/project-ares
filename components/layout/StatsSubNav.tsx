"use client";

// StatsSubNav — sub-tabs for the three "stats" pages (Fortschritt / Sensors /
// History). Sprint v0.8's main FloatingNav was reduced to 5 primary items
// per brief, which dropped /sensors and /history from the visible nav.
// This sub-nav restores the click-path: each stats page renders it at the
// top, active tab gets cyan, others stay muted.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
}

const TABS: Tab[] = [
  { href: "/progress", label: "Fortschritt" },
  { href: "/sensors", label: "Sensors" },
  { href: "/history", label: "History" },
];

export function StatsSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Stats-Navigation"
      className="flex items-center gap-1 overflow-x-auto"
    >
      <div
        className="inline-flex items-center gap-0.5 rounded-full border p-1"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-elevated)",
        }}
      >
        {TABS.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium tabular-nums transition-all duration-200",
                active
                  ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated-hover)] hover:text-[var(--text-secondary)]",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
