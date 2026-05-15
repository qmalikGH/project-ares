"use client";

// AppShell (Sprint v0.8) — slim layout host for the floating pill nav.
// The old sidebar + mobile-bottom-nav grid has been replaced by a single
// FloatingNav (bottom on mobile, top-center on desktop).
// NotificationsBell + GarminSyncIndicator live as a small floating cluster
// in the opposite corner so they stay accessible without crowding the nav.
//
// v0.9 additions:
// - Service worker registration (production only) for app-shell offline cache
// - IOSInstallHint nudges first-time iPhone visitors to add to home screen
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { FloatingNav } from "./FloatingNav";
import { GarminSyncIndicator } from "./GarminSyncIndicator";
import { IOSInstallHint } from "./IOSInstallHint";
import { NotificationsBell } from "./NotificationsBell";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .catch((e) => console.error("[sw] register failed:", e));
  }, []);

  return (
    <div
      className="min-h-screen pt-[max(env(safe-area-inset-top,0px),0.5rem)] pb-[calc(7rem+env(safe-area-inset-bottom,0px))]"
    >
      {/* Status / notifications cluster — bottom-left on mobile (next to nav),
          top-right on desktop. Glass pill, subtle. */}
      <div
        className="fixed top-6 right-4 z-40 hidden items-center gap-2 sm:flex"
        aria-label="Status"
      >
        <div
          className="flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur-[20px]"
          style={{
            borderColor: "var(--color-border)",
            background: "rgba(10,10,11,0.7)",
          }}
        >
          <GarminSyncIndicator compact />
          <NotificationsBell />
          <button
            type="button"
            onClick={() => router.push("/settings")}
            aria-label="Settings"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
            style={{ color: "var(--color-foreground-secondary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className="fixed right-4 z-40 flex items-center gap-2 sm:hidden"
        style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
        aria-label="Status"
      >
        <GarminSyncIndicator compact />
        <NotificationsBell />
        <button
          type="button"
          onClick={() => router.push("/settings")}
          aria-label="Settings"
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{ color: "var(--color-foreground-secondary)" }}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-lg">
        {children}
      </div>

      <FloatingNav />
      <IOSInstallHint />
    </div>
  );
}
