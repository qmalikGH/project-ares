"use client";

// Sprint 3.4 (#28, C3): one tap a week for the shin. Shows on /today when
// there was no shin signal (card, coach or rated session) in the last 7 days.
// The volume gate stays on "hold" without any signal in 14 days — this card
// is the cheapest way to give it one.
import { useEffect, useState } from "react";

const BUCKETS = [
  { bucket: "0", label: "0" },
  { bucket: "1-2", label: "1–2" },
  { bucket: "3", label: "3" },
  { bucket: "4+", label: "4+" },
] as const;

export function ShinWeekCard({ onReported }: { onReported?: () => void }) {
  const [needed, setNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shin-report")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setNeeded(d?.needed === true))
      .catch(() => {});
  }, []);

  async function report(bucket: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/shin-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDone(true);
      onReported?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fehler beim Speichern");
    } finally {
      setBusy(false);
    }
  }

  if (!needed) return null;
  if (done) {
    return (
      <p className="mb-6 text-xs text-[var(--color-foreground-tertiary)]">
        Schienbein für diese Woche gemeldet. Danke.
      </p>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--color-border)] px-4 py-3">
      <p className="label">Schienbein diese Woche</p>
      <p className="mt-0.5 text-xs text-[var(--color-foreground-secondary)]">
        Schmerz unter Belastung, 0–10. Ein Tipp pro Woche reicht.
      </p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {BUCKETS.map((b) => (
          <button
            key={b.bucket}
            type="button"
            disabled={busy}
            onClick={() => report(b.bucket)}
            className="rounded-md border border-[var(--color-border)] py-2 text-sm font-semibold transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            {b.label}
          </button>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </section>
  );
}
