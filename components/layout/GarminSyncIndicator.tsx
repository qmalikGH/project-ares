"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";

type GarminStatus = {
  lastSync: {
    syncedAt: string;
    status: string;
    hrvSyncOk: boolean;
    sleepSyncOk: boolean;
    bodyBatterySyncOk: boolean;
    rhrSyncOk: boolean;
    activitiesSyncOk: boolean;
    energySyncOk: boolean;
  } | null;
  consecutiveFailures: number;
};

/**
 * Compact Garmin sync status — small icon with status color in the AppShell.
 * Click → popover with detail + manual sync trigger.
 * Replaces the full GarminSyncCard that lived on the Today page in v0.2.
 */
export function GarminSyncIndicator({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sensors/garmin-status");
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/sensors/garmin-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (!r.ok && data.status !== "PARTIAL") {
        throw new Error(data.error ?? data.status ?? `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const lastStatus = status?.lastSync?.status;
  const dotColor = (() => {
    if (!status?.lastSync) return "bg-slate-400";
    if (lastStatus === "SUCCESS") return "bg-emerald-500";
    if (lastStatus === "PARTIAL") return "bg-yellow-500";
    return "bg-red-500";
  })();

  const lastSyncAt = status?.lastSync?.syncedAt ? new Date(status.lastSync.syncedAt) : null;
  const minutesAgo = lastSyncAt ? Math.round((Date.now() - lastSyncAt.getTime()) / 60000) : null;
  const ageLabel =
    minutesAgo === null
      ? "noch nie gesynct"
      : minutesAgo < 1
      ? "gerade gesynct"
      : minutesAgo < 60
      ? `vor ${minutesAgo} min`
      : `vor ${Math.round(minutesAgo / 60)}h`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative flex ${compact ? "h-8 w-8" : "items-center gap-2 px-2 h-8"} rounded-md border hover:bg-accent`}
        aria-label="Garmin Sync Status"
        title={`Garmin: ${ageLabel}`}
      >
        <Activity className="h-4 w-4" />
        <span className={`absolute ${compact ? "top-1 right-1" : "top-1.5 right-1.5"} h-2 w-2 rounded-full ${dotColor}`} />
        {!compact && <span className="text-xs text-muted-foreground">Garmin</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-72 rounded-lg border bg-card shadow-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Garmin Sync</span>
            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
          </div>
          <p className="text-xs text-muted-foreground">{ageLabel}</p>
          {status?.lastSync && (
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <div>HRV: {status.lastSync.hrvSyncOk ? "✓" : "✗"}</div>
              <div>Sleep: {status.lastSync.sleepSyncOk ? "✓" : "✗"}</div>
              <div>Body Battery: {status.lastSync.bodyBatterySyncOk ? "✓" : "✗"}</div>
              <div>RHR: {status.lastSync.rhrSyncOk ? "✓" : "✗"}</div>
              <div>Kalorien: {status.lastSync.energySyncOk ? "✓" : "✗"}</div>
              <div>Activities: {status.lastSync.activitiesSyncOk ? "✓" : "✗"}</div>
            </div>
          )}
          {status?.consecutiveFailures && status.consecutiveFailures > 0 ? (
            <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">
              {status.consecutiveFailures}× in Folge fehlgeschlagen
            </p>
          ) : null}
          {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
          <button
            onClick={sync}
            disabled={busy}
            className="mt-3 w-full text-xs rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
          >
            {busy ? "syncing…" : "Jetzt synchronisieren"}
          </button>
        </div>
      )}
    </div>
  );
}
