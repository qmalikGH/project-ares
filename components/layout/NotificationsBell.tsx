"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  read: boolean;
  actionUrl: string | null;
  createdAt: string;
};

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/notifications");
      if (r.ok) {
        const data = await r.json();
        setItems(data.items ?? []);
        setUnread(data.unreadCount ?? 0);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  async function markAllRead() {
    const unreadIds = items.filter((i) => !i.read).map((i) => i.id);
    if (unreadIds.length === 0) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unreadIds }),
    });
    load();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-80 rounded-lg border bg-card shadow-lg">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:underline"
              >
                alle lesen
              </button>
            )}
          </header>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Keine Benachrichtigungen.</p>
            ) : (
              items.map((n) => <NotificationItem key={n.id} n={n} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({ n }: { n: Notification }) {
  const sevColor =
    n.severity === "CRITICAL"
      ? "border-l-red-500"
      : n.severity === "WARNING"
      ? "border-l-orange-500"
      : "border-l-blue-500";
  const timeAgo = (() => {
    const min = Math.round((Date.now() - new Date(n.createdAt).getTime()) / 60000);
    if (min < 1) return "gerade";
    if (min < 60) return `${min}min`;
    if (min < 1440) return `${Math.round(min / 60)}h`;
    return `${Math.round(min / 1440)}d`;
  })();
  const inner = (
    <div className={`border-l-2 px-3 py-2 ${sevColor} ${n.read ? "opacity-60" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{n.title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{timeAgo}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
    </div>
  );
  return n.actionUrl ? (
    <a href={n.actionUrl} className="block hover:bg-accent">
      {inner}
    </a>
  ) : (
    inner
  );
}
