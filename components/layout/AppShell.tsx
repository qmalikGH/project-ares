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
import { FloatingNav } from "./FloatingNav";
import { GarminSyncIndicator } from "./GarminSyncIndicator";
import { IOSInstallHint } from "./IOSInstallHint";
import { NotificationsBell } from "./NotificationsBell";

export default function AppShell({ children }: { children: React.ReactNode }) {
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
      // Top: respect iOS safe-area-inset (notch + status bar). iPhone 11 has
      // ~44px reserved at the top when viewportFit:cover is set; without this
      // padding the page header sits right under the clock. `max(safe, 1rem)`
      // keeps a minimum gap on devices without a notch.
      // Bottom: room for the floating nav pill + safe-area inset on iPhones
      // with a home indicator.
      className="min-h-screen pt-[max(env(safe-area-inset-top,0px),0.5rem)] pb-[calc(7rem+env(safe-area-inset-bottom,0px))] sm:pt-24 sm:pb-8"
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
        </div>
      </div>

      <div
        // Mobile cluster sits inside the safe-area too, otherwise the bell
        // and Garmin indicator hide behind the notch / status bar.
        className="fixed right-4 z-40 flex items-center gap-2 sm:hidden"
        style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
        aria-label="Status"
      >
        <GarminSyncIndicator compact />
        <NotificationsBell />
      </div>

      {/* Page content — max-width box on desktop, full-width on mobile */}
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        {children}
      </div>

      <FloatingNav />
      <IOSInstallHint />
    </div>
  );
}
