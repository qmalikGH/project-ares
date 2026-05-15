"use client";

// FloatingNav — full-width bottom bar (v0.12 redesign).
// Solid dark background, icon + label stacked, amber accent for active tab.
// Matches the Direction-C prototype screenshot.
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  Clock,
  Home,
  Target,
  Utensils,
  Zap,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "HEUTE", icon: Home },
  { href: "/week", label: "PLAN", icon: CalendarDays },
  { href: "/progress", label: "STATS", icon: Zap },
  { href: "/nutrition", label: "NUTRITION", icon: Utensils },
  { href: "/goals", label: "ZIELE", icon: Target },
  { href: "/history", label: "HISTORIE", icon: Clock },
];

const ACTIVE_COLOR = "var(--color-session-threshold)";
const INACTIVE_COLOR = "var(--color-foreground-muted)";

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
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        borderTop: "1px solid var(--color-rule)",
        background: "var(--color-background)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <ul
        style={{
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-around",
          margin: 0,
          padding: "8px 0 6px",
          listStyle: "none",
        }}
      >
        {NAV_ITEMS.map((item, index) => {
          const isActive = index === activeIndex;
          const Icon = item.icon;
          const color = isActive ? ACTIVE_COLOR : INACTIVE_COLOR;

          return (
            <li key={item.href} style={{ flex: 1 }}>
              <button
                type="button"
                onClick={() => router.push(item.href)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  width: "100%",
                  padding: "2px 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  transition: "opacity 0.15s",
                  opacity: isActive ? 1 : 0.7,
                }}
              >
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2 : 1.5}
                  style={{ color, transition: "color 0.15s" }}
                />
                <span
                  className="label"
                  style={{
                    margin: 0,
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    fontWeight: isActive ? 600 : 500,
                    color,
                    transition: "color 0.15s",
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
