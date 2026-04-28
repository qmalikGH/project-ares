"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompletionFlow } from "@/components/workout/CompletionFlow";
import {
  SESSION_LABEL,
  prettyPhase,
  slotLabel,
} from "@/components/training/shared";
import type {
  ExerciseShape,
  FinalSessionShape,
  SessionShape,
} from "@/components/training/shared";
import type { Exercise } from "@/lib/coach-engine/types";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────

type SensorOutputs = {
  readiness: {
    score: number;
    band: string;
    components: Record<string, number>;
    trend7d: string;
  };
  load: {
    acwrRolling: number;
    band: string;
    acute7d: number;
    chronic28d: number;
    daysOfData: number;
  };
  limitations: {
    kneeScoreToday: number;
    therapyPhase: string;
    constraints: string[];
    kneeTrend7d?: string;
  };
};

type TodayResponse =
  | {
      status: "AWAITING_MORNING_INPUT";
      plannedSession: SessionShape;
      plannedSessions?: SessionShape[];
    }
  | {
      status: "READY";
      plannedSession: SessionShape;
      plannedSessions?: SessionShape[];
      finalSession: FinalSessionShape;
      finalSessions?: FinalSessionShape[];
      sensorOutputs: SensorOutputs;
      week: { weekNumber: number; blockNumber: number; phaseName: string };
    }
  | { status: "NO_ACTIVE_PLAN" | "NO_WEEK_PLAN" | "NO_SESSION_TODAY" };

type WorkoutState = { id: string; status: string } | null;

// ─────────────────────────────────────────────────────
// Band styling helpers
// ─────────────────────────────────────────────────────

const BAND: Record<string, { bg: string; text: string; border: string }> = {
  GREEN:            { bg: "bg-emerald-500/15", text: "text-emerald-400",  border: "border-emerald-500/30" },
  YELLOW:           { bg: "bg-yellow-500/15",  text: "text-yellow-300",   border: "border-yellow-500/30" },
  ORANGE:           { bg: "bg-orange-500/15",  text: "text-orange-300",   border: "border-orange-500/30" },
  RED:              { bg: "bg-red-500/15",      text: "text-red-400",      border: "border-red-500/30" },
  OPTIMAL:          { bg: "bg-emerald-500/15", text: "text-emerald-400",  border: "border-emerald-500/30" },
  LOW:              { bg: "bg-blue-500/15",    text: "text-blue-400",     border: "border-blue-500/30" },
  HIGH:             { bg: "bg-orange-500/15",  text: "text-orange-300",   border: "border-orange-500/30" },
  DANGER:           { bg: "bg-red-500/15",      text: "text-red-400",      border: "border-red-500/30" },
  BASELINE_BUILDING:{ bg: "bg-slate-500/10",  text: "text-slate-400",    border: "border-slate-500/30" },
};
const BAND_DEFAULT = {
  bg: "bg-white/[0.04]",
  text: "text-[var(--text-secondary)]",
  border: "border-[var(--border-subtle)]",
};

function band(key: string) {
  return BAND[key] ?? BAND_DEFAULT;
}

// ─────────────────────────────────────────────────────
// Severity helpers (for NumberSelector coloring)
// ─────────────────────────────────────────────────────

type Severity = "good" | "ok" | "bad";

function severity(n: number, highIsGood: boolean): Severity {
  const level = n >= 7 ? "high" : n >= 4 ? "mid" : "low";
  const map = highIsGood
    ? { high: "good", mid: "ok", low: "bad" }
    : { high: "bad", mid: "ok", low: "good" };
  return map[level] as Severity;
}

const SEV_TEXT: Record<Severity, string> = {
  good: "text-emerald-400",
  ok:   "text-yellow-300",
  bad:  "text-red-400",
};

const SEV_BUTTON: Record<Severity, string> = {
  good: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  ok:   "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  bad:  "bg-red-500/20 text-red-400 border-red-500/30",
};

// ─────────────────────────────────────────────────────
// Knee-pill visibility (unchanged engine logic)
// ─────────────────────────────────────────────────────

function shouldShowKneePill(
  outputs: SensorOutputs,
  todaySessionType: string | null,
): boolean {
  const { kneeScoreToday, therapyPhase, constraints, kneeTrend7d } =
    outputs.limitations;
  if (kneeScoreToday >= 5) return true;
  if (kneeTrend7d === "declining") return true;
  const isStrength = todaySessionType?.startsWith("strength") ?? false;
  const isRun = todaySessionType?.includes("run") ?? false;
  if ((therapyPhase === "REACTIVE" || therapyPhase === "DISREPAIR") && isStrength) return true;
  for (const c of constraints) {
    if ((c === "no_plyo" || c === "strength_load_cap_70") && isStrength) return true;
    if ((c === "run_intensity_max_M" || c === "no_high_intensity" || c === "no_intervals_under_3min") && isRun) return true;
    if (c === "no_threshold_or_higher" && isRun) return true;
    if (c === "force_recovery_session") return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="space-y-2">
        <div className="h-7 w-52 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="h-4 w-44 animate-pulse rounded-md bg-white/[0.04]" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-xl bg-white/[0.04]" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-2xl bg-white/[0.04]" />
      <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Empty / error card
// ─────────────────────────────────────────────────────

function EmptyCard({ title, message }: { title: string; message: string }) {
  return (
    <section className="glass-card p-6">
      <p className="text-sm font-semibold text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-tertiary)]">{message}</p>
    </section>
  );
}

// ─────────────────────────────────────────────────────
// Status pill (compact sensor card)
// ─────────────────────────────────────────────────────

function StatusPill({
  title,
  primary,
  sub,
  bandKey,
  meta,
  tooltip,
}: {
  title: string;
  primary: string;
  sub: string;
  bandKey: string;
  meta?: string;
  tooltip?: string;
}) {
  const s = band(bandKey);
  return (
    <div
      className={cn("rounded-xl border px-3 py-3", s.bg, s.border)}
      title={tooltip}
    >
      <p className={cn("text-[10px] font-medium uppercase tracking-widest opacity-60", s.text)}>
        {title}
      </p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn("font-bold tabular-nums text-lg leading-none", s.text)}>
          {primary}
        </span>
        <span className={cn("text-[10px] font-semibold uppercase tracking-wider", s.text)}>
          {sub}
        </span>
      </div>
      {meta && (
        <p className={cn("mt-1 text-[10px] leading-tight opacity-70", s.text)}>
          {meta}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Recovery strip
// ─────────────────────────────────────────────────────

function RecoveryStrip({
  outputs,
  sessionType,
}: {
  outputs: SensorOutputs;
  sessionType: string | null;
}) {
  const showKnee = shouldShowKneePill(outputs, sessionType);
  const acwr = outputs.load;
  const isColdStart = acwr.band === "BASELINE_BUILDING";

  const kneeKey =
    outputs.limitations.kneeScoreToday >= 7 ? "RED"
    : outputs.limitations.kneeScoreToday >= 5 ? "ORANGE"
    : outputs.limitations.kneeScoreToday >= 3 ? "YELLOW"
    : "GREEN";

  return (
    <div className={cn("grid gap-3", showKnee ? "grid-cols-3" : "grid-cols-2")}>
      <StatusPill
        title="Readiness"
        primary={String(outputs.readiness.score)}
        sub={outputs.readiness.band}
        bandKey={outputs.readiness.band}
        meta={`7d: ${outputs.readiness.trend7d}`}
      />
      <StatusPill
        title="ACWR"
        primary={isColdStart ? "—" : acwr.acwrRolling.toFixed(2)}
        sub={isColdStart ? "BASELINE" : acwr.band}
        bandKey={acwr.band}
        meta={
          isColdStart
            ? `Tag ${acwr.daysOfData}/14`
            : `${Math.round(acwr.acute7d)} / ${Math.round(acwr.chronic28d)}`
        }
        tooltip={
          isColdStart
            ? "ACWR braucht 14+ Tage für eine valide Auswertung."
            : `Rolling=${acwr.acwrRolling.toFixed(2)}`
        }
      />
      {showKnee && (
        <StatusPill
          title="Knee"
          primary={String(outputs.limitations.kneeScoreToday)}
          sub={outputs.limitations.therapyPhase}
          bandKey={kneeKey}
          meta={
            outputs.limitations.constraints.length > 0
              ? `${outputs.limitations.constraints.length} constraint${outputs.limitations.constraints.length > 1 ? "s" : ""}`
              : "keine Constraints"
          }
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Session hero card
// ─────────────────────────────────────────────────────

function sessionStatusLabel(ws: WorkoutState): { label: string; className: string } {
  if (ws?.status === "in_progress")
    return { label: "Live", className: "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]" };
  if (ws?.status === "completed")
    return { label: "Abgeschlossen", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
  return { label: "Geplant", className: "border-[var(--border-strong)] text-[var(--text-secondary)]" };
}

function SessionHeroCard({
  final,
  workoutState,
}: {
  final: FinalSessionShape;
  workoutState: WorkoutState;
}) {
  const isPaceFirst = final.controlMethod === "pace_first";
  const pace = final.paceTarget;
  const paceDisplay = pace
    ? pace.from === pace.to ? pace.from : `${pace.from}–${pace.to}`
    : null;
  const statusBadge = sessionStatusLabel(workoutState);

  return (
    <div className="glass-card-hero p-6 sm:p-8">
      <div className="relative z-[1]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {SESSION_LABEL[final.type] ?? final.type}
            </h2>
            {final.durationMin && (
              <p className="mt-0.5 tabular-nums text-sm text-[var(--text-secondary)]">
                {final.durationMin} min
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
              statusBadge.className,
            )}>
              {statusBadge.label}
            </span>
            {final.wasModified && (
              <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/15 px-2.5 py-0.5 text-xs font-semibold text-yellow-300">
                ↻ angepasst
              </span>
            )}
          </div>
        </div>

        {/* Primary metric */}
        {!isPaceFirst && final.hrTarget ? (
          <div className="mt-6">
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
              Herzfrequenz
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-display-2xl tabular-nums text-[var(--accent)]">
                {final.hrTarget.from}–{final.hrTarget.to}
              </span>
              <span className="text-base text-[var(--text-secondary)]">bpm</span>
            </div>
          </div>
        ) : paceDisplay ? (
          <div className="mt-6">
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
              Pace
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-display-2xl tabular-nums text-[var(--accent)]">
                {paceDisplay}
              </span>
              <span className="text-base text-[var(--text-secondary)]">/km</span>
            </div>
          </div>
        ) : null}

        {/* Secondary metric — pace when HR is primary */}
        {!isPaceFirst && final.hrTarget && paceDisplay && (
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
              Pace{" "}
              <span className="normal-case italic tracking-normal">
                (orientierend)
              </span>
            </p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="tabular-nums text-lg text-[var(--text-secondary)]">
                {paceDisplay}
              </span>
              <span className="text-sm text-[var(--text-tertiary)]">/km</span>
            </div>
          </div>
        )}

        {/* Zone + RPE */}
        {(final.intensityZone || final.rpeTarget != null) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {final.intensityZone && (
              <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                Zone {final.intensityZone}
              </span>
            )}
            {final.rpeTarget != null && (
              <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                RPE {final.rpeTarget}
              </span>
            )}
          </div>
        )}

        {/* Exercise list for strength sessions */}
        {final.exercises && final.exercises.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-4 text-sm">
            {final.exercises.map((ex, i) => (
              <li key={i}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-[var(--text-primary)]">{ex.name}</span>
                  <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                    {ex.sets} × {ex.reps}
                    {ex.loadPct ? ` @ ${ex.loadPct}%` : ""}
                  </span>
                </div>
                {(ex.tempo || ex.restSec !== undefined || ex.rpeCap !== undefined) && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--text-tertiary)]">
                    {ex.tempo && <span>Tempo {ex.tempo}</span>}
                    {ex.restSec !== undefined && (
                      <span>Pause {ex.restSec >= 60 ? `${Math.round(ex.restSec / 60)}min` : `${ex.restSec}s`}</span>
                    )}
                    {ex.rpeCap !== undefined && <span>RPE-Cap {ex.rpeCap}</span>}
                  </div>
                )}
                {ex.notes && (
                  <p className="mt-0.5 text-xs italic text-[var(--text-tertiary)]">{ex.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Notes */}
        {final.notes && (
          <p className="mt-4 text-sm italic text-[var(--text-tertiary)]">{final.notes}</p>
        )}

        {/* Modification reasons */}
        {final.modifications.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
            {final.modifications.map((m, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-tertiary)]">
                <span className="mt-px shrink-0 opacity-50">→</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Low confidence warning */}
        {final.confidence < 70 && (
          <p
            className="mt-3 text-xs text-[var(--text-tertiary)]"
            title="Engine-Konfidenz basierend auf Datenqualität und Sensor-Vollständigkeit."
          >
            ⚠ Konfidenz {final.confidence}/100
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Two-a-day section
// ─────────────────────────────────────────────────────

function TwoADaySection({
  finalSessions,
  workoutState,
}: {
  finalSessions: FinalSessionShape[];
  workoutState: WorkoutState;
}) {
  const meaningful = finalSessions.filter((s) => s.type !== "rest");
  const sessions = meaningful.length > 0 ? meaningful : finalSessions;

  return (
    <div className="flex flex-col gap-4">
      {sessions.map((s, i) => {
        const slot = slotLabel(s.type);
        return (
          <div key={i}>
            {slot && (
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                {slot}
              </p>
            )}
            <SessionHeroCard final={s} workoutState={workoutState} />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Coach block
// ─────────────────────────────────────────────────────

function CoachBlock({ finalSession }: { finalSession: FinalSessionShape }) {
  const [aiText, setAiText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchExplanation = useCallback(async (force = false) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/coach/explain-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (data.status === "AI_COACH_DISABLED") { setAiText(null); return; }
      if (data.status !== "ok") { setErr(`AI: ${data.status}`); return; }
      setAiText(data.explanation);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExplanation(false); }, [fetchExplanation]);

  const text = aiText ?? (!loading && !err ? finalSession.explanation : null);

  return (
    <section className="glass-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Coach</h3>
        <button
          onClick={() => fetchExplanation(true)}
          disabled={loading}
          className="text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] disabled:opacity-40"
        >
          {loading ? "…" : "neu"}
        </button>
      </div>

      <div className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
        {loading && !aiText && (
          <span className="italic text-[var(--text-tertiary)]">Coach denkt nach…</span>
        )}
        {err && <span className="text-red-400">{err}</span>}
        {text && <span>{text}</span>}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────
// Number selector (replaces <input type="range">)
// ─────────────────────────────────────────────────────

function NumberSelector({
  label,
  hint,
  value,
  onChange,
  highIsGood = true,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  highIsGood?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </label>
        <span className={cn("text-sm font-bold tabular-nums transition-colors", SEV_TEXT[severity(value, highIsGood)])}>
          {value}/10
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const isSelected = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange(n)}
              className={cn(
                "flex h-8 min-w-0 flex-1 items-center justify-center rounded border",
                "text-xs font-medium transition-all duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-ring)]",
                isSelected
                  ? SEV_BUTTON[severity(n, highIsGood)]
                  : "border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-tertiary)] hover:bg-white/[0.07] hover:text-[var(--text-secondary)]",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">{hint}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Morning ritual
// ─────────────────────────────────────────────────────

function MorningRitual({
  onSubmitted,
  plannedSession,
}: {
  onSubmitted: () => void;
  plannedSession: SessionShape;
}) {
  const [subjectiveRecovery, setSubj] = useState(7);
  const [morningStiffness, setStiff] = useState(3);
  const [stairsScore, setStairs] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/sensors/morning-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectiveRecovery, morningStiffness, stairsScore }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fehler beim Speichern");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="glass-card p-6">
      {/* Context header */}
      <div className="mb-6">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Morning Check-in
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Heute geplant:{" "}
          <span className="font-medium text-[var(--text-primary)]">
            {SESSION_LABEL[plannedSession.type] ?? plannedSession.type}
          </span>
          {plannedSession.durationMin ? (
            <span className="tabular-nums"> · {plannedSession.durationMin} min</span>
          ) : null}
        </p>
      </div>

      {/* Inputs */}
      <div className="flex flex-col gap-6">
        <NumberSelector
          label="Erholung"
          hint="1 = erschöpft · 10 = topfit"
          value={subjectiveRecovery}
          onChange={setSubj}
          highIsGood
        />
        <NumberSelector
          label="Knie-Steifheit"
          hint="1 = keine · 10 = stark"
          value={morningStiffness}
          onChange={setStiff}
          highIsGood={false}
        />
        <NumberSelector
          label="Treppensteigen"
          hint="1 = schmerzfrei · 10 = starker Schmerz"
          value={stairsScore}
          onChange={setStairs}
          highIsGood={false}
        />
      </div>

      {err && <p className="mt-4 text-sm text-red-400">{err}</p>}

      <Button
        onClick={submit}
        disabled={submitting}
        size="lg"
        className="mt-6 w-full"
      >
        {submitting ? "Berechne…" : "Session berechnen"}
      </Button>
    </section>
  );
}

// ─────────────────────────────────────────────────────
// Actions zone
// ─────────────────────────────────────────────────────

function ActionsZone({
  onChanged,
  sessionType,
  plannedExercises,
  plannedDurationMin,
  workoutState,
  onWorkoutStateChange,
}: {
  onChanged: () => void;
  sessionType: string;
  plannedExercises: ExerciseShape[];
  plannedDurationMin: number;
  workoutState: WorkoutState;
  onWorkoutStateChange: (ws: WorkoutState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (sessionType === "rest") {
    return (
      <p className="py-2 text-center text-sm text-[var(--text-tertiary)]">
        Heute Ruhetag.
      </p>
    );
  }

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sessions/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.status ?? `HTTP ${res.status}`);
      onWorkoutStateChange({ id: data.workoutId, status: "in_progress" });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fehler beim Starten");
    } finally {
      setBusy(false);
    }
  }

  if (workoutState?.status === "completed") {
    return (
      <section className="glass-card border-emerald-500/20 bg-emerald-500/[0.04] p-5">
        <p className="text-sm font-medium text-emerald-400">Session abgeschlossen</p>
      </section>
    );
  }

  if (workoutState?.status === "in_progress") {
    return (
      <section className="glass-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
          Session abschließen
        </h3>
        <CompletionFlow
          workoutId={workoutState.id}
          sessionType={sessionType}
          plannedExercises={plannedExercises as unknown as Exercise[]}
          durationMin={plannedDurationMin}
          onComplete={() => {
            onWorkoutStateChange({ id: workoutState.id, status: "completed" });
            onChanged();
          }}
        />
      </section>
    );
  }

  return (
    <div>
      <Button onClick={start} disabled={busy} size="lg" className="w-full">
        {busy ? "Starte…" : "Session starten"}
      </Button>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Main dashboard
// ─────────────────────────────────────────────────────

export default function TodayDashboard() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workoutState, setWorkoutState] = useState<WorkoutState>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = (await fetch("/api/sessions/today").then((r) =>
        r.json(),
      )) as TodayResponse;
      setToday(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch today's workout state independently so hero badge stays in sync
  useEffect(() => {
    fetch("/api/workouts?days=1")
      .then((r) => r.json())
      .then((data) => {
        const todayKey = new Date().toISOString().slice(0, 10);
        const w = (data.workouts as { id: string; date: string; status: string }[] | undefined)
          ?.find((x) => x.date.slice(0, 10) === todayKey);
        if (w) setWorkoutState({ id: w.id, status: w.status });
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading && !today) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <EmptyCard title="Fehler" message={error} />
      </div>
    );
  }

  if (!today) return null;

  const dateStr = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {dateStr}
        </h1>
        {today.status === "READY" && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-sm text-[var(--text-secondary)]">
              Block {today.week.blockNumber} · {prettyPhase(today.week.phaseName)} · Woche {today.week.weekNumber}
            </p>
            {!shouldShowKneePill(today.sensorOutputs, today.finalSession.type) && (
              <p className="text-xs text-[var(--text-tertiary)]">
                Knie {today.sensorOutputs.limitations.kneeScoreToday}/10 · {today.sensorOutputs.limitations.therapyPhase}
              </p>
            )}
          </div>
        )}
      </header>

      {/* Empty states */}
      {today.status === "NO_ACTIVE_PLAN" && (
        <EmptyCard
          title="Kein aktiver Plan"
          message="Schließe das Onboarding ab, um deinen Trainingsplan zu starten."
        />
      )}
      {today.status === "NO_WEEK_PLAN" && (
        <EmptyCard
          title="Kein Wochenplan"
          message="Der Wochenplan wird automatisch generiert. Schau später wieder vorbei."
        />
      )}
      {today.status === "NO_SESSION_TODAY" && (
        <EmptyCard
          title="Ruhetag"
          message="Heute keine Session geplant. Erholung ist Training."
        />
      )}

      {/* Awaiting morning input */}
      {today.status === "AWAITING_MORNING_INPUT" && (
        <MorningRitual onSubmitted={refresh} plannedSession={today.plannedSession} />
      )}

      {/* Ready: full dashboard */}
      {today.status === "READY" && (
        <>
          <RecoveryStrip
            outputs={today.sensorOutputs}
            sessionType={today.finalSession.type}
          />

          {(today.finalSessions?.length ?? 0) > 1 ? (
            <TwoADaySection
              finalSessions={today.finalSessions!}
              workoutState={workoutState}
            />
          ) : (
            <SessionHeroCard
              final={today.finalSession}
              workoutState={workoutState}
            />
          )}

          <CoachBlock finalSession={today.finalSession} />

          <ActionsZone
            onChanged={refresh}
            sessionType={today.finalSession.type}
            plannedExercises={today.finalSession.exercises ?? []}
            plannedDurationMin={today.finalSession.durationMin ?? 45}
            workoutState={workoutState}
            onWorkoutStateChange={setWorkoutState}
          />
        </>
      )}
    </div>
  );
}
