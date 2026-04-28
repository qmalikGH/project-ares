"use client";

// AppShell (Sprint v0.8) — slim layout host for the floating pill nav.
// The old sidebar + mobile-bottom-nav grid has been replaced by a single
// FloatingNav (bottom on mobile, top-center on desktop).
// NotificationsBell + GarminSyncIndicator live as a small floating cluster
// in the opposite corner so they stay accessible without crowding the nav.
import { FloatingNav } from "./FloatingNav";
import { GarminSyncIndicator } from "./GarminSyncIndicator";
import { NotificationsBell } from "./NotificationsBell";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-28 sm:pt-24 sm:pb-8">
      {/* Status / notifications cluster — bottom-left on mobile (next to nav),
          top-right on desktop. Glass pill, subtle. */}
      <div
        className="fixed top-6 right-4 z-40 hidden items-center gap-2 sm:flex"
        aria-label="Status"
      >
        <div
          className="flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur-[20px]"
          style={{
            borderColor: "var(--border-subtle)",
            background: "rgba(10,10,11,0.7)",
          }}
        >
          <GarminSyncIndicator compact />
          <NotificationsBell />
        </div>
      </div>

      <div
        className="fixed top-4 right-4 z-40 flex items-center gap-2 sm:hidden"
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
    </div>
  );
}
