"use client";

// Bulk session confirmation — Sprint 3.0.
//
// The athlete trains and never opens the completion wizard. The nightly Garmin
// import fills in everything the watch measured; this screen collects the two
// things it cannot know (effort and shin pain) plus, for strength, whether the
// session ran as written. A week in under a minute, retroactively.

import { useCallback, useEffect, useState } from "react";

import { NumberSelector, SHIN_THRESHOLDS } from "@/components/ui/NumberSelector";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SESSION_LABEL } from "@/components/training/shared";
import { getSessionColor } from "@/lib/ui/session-colors";
import { cn } from "@/lib/utils";

interface PrescribedExercise {
  name: string;
  sets: number;
  reps: number | string;
  loadAbs: number | null;
  willLog: boolean;
}

interface OpenSession {
  id: string;
  date: string;
  type: string;
  cohort: "planned" | "garmin_auto";
  discipline: "run" | "strength" | "other";
  plannedDurationMin: number | null;
  garmin: {
    activityId: string | null;
    durationSec: number | null;
    distanceM: number | null;
    averageHr: number | null;
  } | null;
  prescribed: { exercises: PrescribedExercise[] } | null;
}

interface Draft {
  rpe: number | null;
  shin: number | null;
  asPrescribed: boolean;
  skip: boolean;
}

interface ConfirmResponse {
  attested: number;
  skipped: number;
  failed: number;
  regenerate: { gate?: string; gateReason?: string; layoffActive?: boolean; regenerated?: number } | null;
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

function summaryLine(s: OpenSession): string {
  if (s.garmin) {
    const parts: string[] = [];
    if (s.garmin.distanceM) parts.push(`${(s.garmin.distanceM / 1000).toFixed(2)} km`);
    if (s.garmin.durationSec) parts.push(`${Math.round(s.garmin.durationSec / 60)} min`);
    if (s.garmin.averageHr) parts.push(`⌀ ${s.garmin.averageHr} bpm`);
    return parts.join(" · ") || "von der Uhr importiert";
  }
  const parts: string[] = [];
  if (s.plannedDurationMin) parts.push(`geplant ${s.plannedDurationMin} min`);
  const loggable = s.prescribed?.exercises.filter((e) => e.willLog).length ?? 0;
  if (s.prescribed) parts.push(`${s.prescribed.exercises.length} Übungen`);
  if (loggable > 0) parts.push(`${loggable} mit Last`);
  return parts.join(" · ") || "keine Details";
}

export default function ConfirmView() {
  const [sessions, setSessions] = useState<OpenSession[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConfirmResponse | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/sessions/open?days=7");
      const d = (await r.json()) as { sessions: OpenSession[] };
      setSessions(d.sessions);
      setDrafts(
        Object.fromEntries(
          d.sessions.map((s) => [s.id, { rpe: null, shin: null, asPrescribed: true, skip: false }]),
        ),
      );
      if (d.sessions.length > 0) setExpanded(d.sessions[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden fehlgeschlagen");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const ready = (s: OpenSession) => {
    const d = drafts[s.id];
    if (!d) return false;
    return d.skip || (d.rpe !== null && d.shin !== null);
  };

  const pending = (sessions ?? []).filter((s) => {
    const d = drafts[s.id];
    return d && (d.skip || d.rpe !== null || d.shin !== null);
  });
  const canSubmit = pending.length > 0 && pending.every(ready);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const items = pending.map((s) => {
        const d = drafts[s.id];
        if (d.skip) return { workoutId: s.id, action: "skip" as const };
        return {
          workoutId: s.id,
          action: "attest" as const,
          rpe: d.rpe as number,
          shinPainNrs: d.shin as number,
          ...(s.discipline === "strength" && s.cohort === "planned"
            ? { asPrescribed: d.asPrescribed }
            : {}),
        };
      });
      const r = await fetch("/api/sessions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = (await r.json()) as ConfirmResponse & { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Speichern fehlgeschlagen");
      setResult(d);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  if (error && !sessions) {
    return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  }
  if (!sessions) {
    return <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>;
  }

  return (
    <div className="flex w-full flex-col gap-5 px-6" style={{ paddingTop: 24, paddingBottom: 120 }}>
      <div>
        <h1 className="text-xl font-semibold">Einheiten bestätigen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Die Uhr hat Dauer, Strecke und Puls schon geliefert. Fehlen: wie anstrengend es war und
          was das Schienbein gesagt hat.
        </p>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-300">
            {result.attested} bestätigt
            {result.skipped > 0 ? `, ${result.skipped} als ausgefallen markiert` : ""}
            {result.failed > 0 ? `, ${result.failed} nicht möglich` : ""}
          </p>
          {/* The plan may have just changed underneath him. Say so, in the
              engine's own words, rather than letting him discover it later. */}
          {result.regenerate?.gateReason && (
            <p className="mt-2 text-emerald-200/80">
              Plan neu berechnet ({result.regenerate.regenerated} Wochen) — Bremse:{" "}
              <span className="font-medium">{result.regenerate.gate}</span> ·{" "}
              {result.regenerate.gateReason}
            </p>
          )}
        </div>
      )}

      {sessions.length === 0 && (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
          Nichts offen. Alle Einheiten der letzten 7 Tage sind bestätigt.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {sessions.map((s) => {
          const d = drafts[s.id];
          const color = getSessionColor(s.type);
          const isOpen = expanded === s.id;
          return (
            <div
              key={s.id}
              className={cn(
                "rounded-lg border bg-white/[0.02] transition-colors",
                d?.skip
                  ? "border-[var(--border-subtle)] opacity-50"
                  : ready(s)
                    ? "border-emerald-500/40"
                    : "border-[var(--border-subtle)]",
              )}
              style={{ borderLeft: `3px solid ${color.color}` }}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="label">{formatDate(s.date)}</span>
                    <span className="text-sm font-medium" style={{ color: color.color }}>
                      {SESSION_LABEL[s.type] ?? s.type}
                    </span>
                    {s.cohort === "garmin_auto" && <span className="chip">Uhr</span>}
                  </div>
                  <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", d?.skip && "line-through")}>
                    {summaryLine(s)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {d?.skip ? "ausgefallen" : ready(s) ? "✓" : isOpen ? "–" : "+"}
                </span>
              </button>

              {isOpen && !d?.skip && (
                <div className="flex flex-col gap-5 border-t border-[var(--border-subtle)] px-4 py-4">
                  <NumberSelector
                    label="Anstrengung (RPE)"
                    hint="1 = locker · 10 = maximal"
                    value={d?.rpe ?? null}
                    onChange={(v) => patch(s.id, { rpe: v })}
                    highIsGood={false}
                  />
                  <NumberSelector
                    label="Schienbein danach (NRS)"
                    hint="0 = keine · ≤3 grün · 4–5 halten · >5 zurücknehmen"
                    value={d?.shin ?? null}
                    onChange={(v) => patch(s.id, { shin: v })}
                    highIsGood={false}
                    min={0}
                    thresholds={SHIN_THRESHOLDS}
                  />

                  {s.discipline === "strength" && s.cohort === "planned" && s.prescribed && (
                    <div>
                      <button
                        type="button"
                        aria-pressed={d?.asPrescribed ?? false}
                        onClick={() => patch(s.id, { asPrescribed: !d?.asPrescribed })}
                        className={cn(
                          "mb-2 w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                          d?.asPrescribed
                            ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                            : "border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-tertiary)]",
                        )}
                      >
                        {d?.asPrescribed ? "✓ Wie vorgegeben gemacht" : "Wie vorgegeben gemacht?"}
                      </button>
                      <ul className="flex flex-col gap-1">
                        {s.prescribed.exercises.map((ex) => (
                          <li
                            key={ex.name}
                            className={cn(
                              "flex items-baseline justify-between text-xs",
                              ex.willLog ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]",
                            )}
                          >
                            <span className={cn(!ex.willLog && "opacity-60")}>{ex.name}</span>
                            <span className="num">
                              {ex.sets}×{ex.reps}
                              {ex.loadAbs ? ` @ ${ex.loadAbs} kg` : ""}
                              {/* Honesty: these are recorded as prescribed, but
                                  they carry no usable 1RM signal, so they never
                                  reach the training-max evaluation. */}
                              {!ex.willLog && <span className="ml-1 opacity-60">· nicht protokolliert</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {s.cohort === "planned" && (
                    <button
                      type="button"
                      onClick={() => patch(s.id, { skip: true })}
                      className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-[var(--text-secondary)]"
                    >
                      War ausgefallen
                    </button>
                  )}
                </div>
              )}

              {d?.skip && (
                <div className="border-t border-[var(--border-subtle)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => patch(s.id, { skip: false })}
                    className="text-xs text-muted-foreground underline underline-offset-2"
                  >
                    doch gemacht
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {sessions.length > 0 && (
        <PrimaryButton onClick={submit} disabled={!canSubmit || busy}>
          {busy ? "Speichere…" : `Bestätigen (${pending.length})`}
        </PrimaryButton>
      )}
    </div>
  );
}
