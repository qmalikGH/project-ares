"use client";

// FloatingNav — restored after the v0.11 sharp-bar attempt didn't land.
// Bottom-positioned on mobile, top-centered on desktop. Glass pill with
// backdrop-blur. Active tab shows a cyan icon + label inside a cyan-muted
// bg pill (Lucide icons; the only place in v0.11 where cyan is the accent
// color — kept inline so the rest of the Direction-C theme stays neutral).
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  Clock,
  Home,
  Target,
  Utensils,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Heute", icon: Home },
  { href: "/week", label: "Plan", icon: CalendarDays },
  { href: "/progress", label: "Stats", icon: Zap },
  { href: "/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/goals", label: "Ziele", icon: Target },
  { href: "/history", label: "Historie", icon: Clock },
];

const NAV_ACCENT = "#7DD3FC";
const NAV_ACCENT_MUTED = "rgba(125, 211, 252, 0.12)";
const NAV_HOVER_BG = "rgba(255, 255, 255, 0.06)";

export function FloatingNav() {
  const pathname = usePathname();
  const router = useRouter();

  const activeIndex = NAV_ITEMS.findIndex(
    (item) =>
      pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <nav
      role="navigation"
      aria-label="Hauptnavigation"
      className={cn(
        // Position: always bottom-center (design prototype)
        "fixed left-1/2 z-50 -translate-x-1/2",
        "bottom-6",
        // Sizing
        "px-2 py-2",
        // Glass pill
        "rounded-full border",
        "bg-[rgba(10,10,11,0.7)] backdrop-blur-[20px]",
        "shadow-[0_8px_32px_-4px_rgba(0,0,0,0.6)]",
      )}
      style={{ borderColor: "var(--color-border)" }}
    >
      <ul className="flex items-center gap-1">
        {NAV_ITEMS.map((item, index) => {
          const isActive = index === activeIndex;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <button
                type="button"
                onClick={() => router.push(item.href)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "group relative flex items-center gap-2 rounded-full",
                  "px-3 py-2 transition-all duration-200",
                )}
                style={{
                  transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  backgroundColor: isActive ? NAV_ACCENT_MUTED : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "";
                }}
              >
                <Icon
                  className="h-5 w-5 transition-colors duration-200"
                  style={{
                    color: isActive
                      ? NAV_ACCENT
                      : "var(--color-foreground-tertiary)",
                  }}
                />
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums transition-all duration-200",
                    isActive
                      ? "max-w-[80px] opacity-100"
                      : "max-w-0 overflow-hidden opacity-0 sm:max-w-[80px] sm:opacity-100",
                  )}
                  style={{
                    color: isActive
                      ? NAV_ACCENT
                      : "var(--color-foreground-secondary)",
                  }}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
