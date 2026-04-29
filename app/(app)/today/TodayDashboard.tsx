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
import { getSessionColor } from "@/lib/ui/session-colors";

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
    <div className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-[0.2em] font-semibold text-[var(--color-foreground-tertiary)]">
        {title}
      </h2>
      <p className="text-[var(--color-foreground-secondary)]">{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Recovery strip (Direction C, Sprint v0.11)
// Inline strip — no cards. Each metric: small uppercase label + mono value.
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
// Recovery strip — Direction C: inline row, no cards
// ─────────────────────────────────────────────────────

function RecoveryMetric({
  label,
  value,
  sub,
  toneColor,
}: {
  label: string;
  value: string;
  sub?: string;
  toneColor?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--color-foreground-muted)]">
        {label}
      </span>
      <span
        className="num-md leading-none"
        style={toneColor ? { color: toneColor } : undefined}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          {sub}
        </span>
      )}
    </div>
  );
}

function bandToToneColor(band: string): string | undefined {
  switch (band) {
    case "RED":
    case "DANGER":
      return "var(--color-destructive)";
    case "ORANGE":
    case "HIGH":
      return "var(--color-warning)";
    case "YELLOW":
      return "var(--color-warning)";
    case "GREEN":
    case "OPTIMAL":
      return "var(--color-success)";
    default:
      return undefined;
  }
}

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
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <RecoveryMetric
        label="Readiness"
        value={String(outputs.readiness.score)}
        sub={outputs.readiness.band}
        toneColor={bandToToneColor(outputs.readiness.band)}
      />
      <RecoveryMetric
        label="ACWR"
        value={isColdStart ? "—" : acwr.acwrRolling.toFixed(2)}
        sub={
          isColdStart
            ? `Baseline · D${acwr.daysOfData}/14`
            : acwr.band
        }
        toneColor={bandToToneColor(acwr.band)}
      />
      {showKnee && (
        <RecoveryMetric
          label="Knee"
          value={String(outputs.limitations.kneeScoreToday)}
          sub={outputs.limitations.therapyPhase}
          toneColor={bandToToneColor(kneeKey)}
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
  const color = getSessionColor(final.type);
  const isPaceFirst = final.controlMethod === "pace_first";
  const pace = final.paceTarget;
  const paceDisplay = pace
    ? pace.from === pace.to ? pace.from : `${pace.from}–${pace.to}`
    : null;
  const isStrength = final.type.startsWith("strength");
  const isRest = final.type === "rest" || final.type === "active_recovery";
  const status = workoutState?.status;

  return (
    <div className="flex flex-col gap-4">
      {/* Title row: session label · status · modulated badge */}
      <div className="flex items-start justify-between gap-4">
        <h2
          className="text-xs uppercase tracking-[0.2em] font-semibold"
          style={{ color: color.color }}
        >
          {SESSION_LABEL[final.type] ?? final.type}
        </h2>
        <div className="flex flex-col items-end gap-1">
          {status === "in_progress" && (
            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--color-success)]">
              · Live
            </span>
          )}
          {status === "completed" && (
            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--color-success)]">
              ✓ Abgeschlossen
            </span>
          )}
          {final.wasModified && (
            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--color-warning)]">
              ↻ angepasst
            </span>
          )}
        </div>
      </div>

      {/* Hero number: HR for hr_first, pace for pace_first/strength fallback */}
      {!isPaceFirst && final.hrTarget ? (
        <div className="flex items-baseline gap-3">
          <span className="num-hero" style={{ color: color.color }}>
            {final.hrTarget.from}–{final.hrTarget.to}
          </span>
          <span className="text-base text-[var(--color-foreground-tertiary)]">
            bpm
          </span>
        </div>
      ) : paceDisplay && !isStrength ? (
        <div className="flex items-baseline gap-3">
          <span className="num-hero" style={{ color: color.color }}>
            {paceDisplay}
          </span>
          <span className="text-base text-[var(--color-foreground-tertiary)]">
            /km
          </span>
        </div>
      ) : null}

      {/* Secondary line: duration + pace (when HR is primary) */}
      {!isRest && (
        <p className="text-sm text-[var(--color-foreground-secondary)]">
          {final.durationMin ? (
            <>
              <span className="num">{final.durationMin}</span> min
            </>
          ) : null}
          {!isPaceFirst && final.hrTarget && paceDisplay && (
            <>
              {" · "}
              <span className="num">{paceDisplay}</span> /km
              <span className="text-[var(--color-foreground-muted)]"> (orient.)</span>
            </>
          )}
        </p>
      )}

      {/* Chips: zoneLabel ∥ Z{n} + RPE */}
      {!isStrength && (final.zoneLabel || final.intensityZone || final.rpeTarget != null) && (
        <div className="flex flex-wrap gap-2">
          {final.zoneLabel ? (
            <span
              className="chip"
              style={{ backgroundColor: color.bg, color: color.color }}
            >
              {final.zoneLabel}
            </span>
          ) : final.intensityZone ? (
            <span
              className="chip"
              style={{ backgroundColor: color.bg, color: color.color }}
            >
              Z{final.intensityZone}
            </span>
          ) : null}
          {final.rpeTarget != null && (
            <span className="chip bg-[var(--color-muted)] text-[var(--color-foreground-secondary)]">
              RPE {final.rpeTarget}
            </span>
          )}
        </div>
      )}

      {/* Strength: duration line + exercise list (always expanded; collapsibility is Phase 5+ polish) */}
      {isStrength && (
        <>
          {final.durationMin && (
            <p className="text-sm text-[var(--color-foreground-secondary)]">
              <span className="num">{final.durationMin}</span> min
            </p>
          )}
          {final.exercises && final.exercises.length > 0 && (
            <ul className="flex flex-col gap-3 mt-1">
              {final.exercises.map((ex, i) => (
                <li key={i} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-foreground-secondary)]">
                    {ex.name}
                  </span>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="num-md text-[var(--color-foreground)]">
                      {ex.sets} × {ex.reps}
                      {ex.loadAbs !== undefined && ex.loadAbs > 0 ? (
                        <>
                          <span className="text-[var(--color-foreground-tertiary)]">
                            {" @ "}
                          </span>
                          {ex.loadAbs} kg
                        </>
                      ) : ex.loadPct ? (
                        <>
                          <span className="text-[var(--color-foreground-tertiary)]">
                            {" @ "}
                          </span>
                          {ex.loadPct}%
                        </>
                      ) : null}
                    </span>
                    {ex.loadAbs !== undefined && ex.loadAbs > 0 && ex.loadPct ? (
                      <span className="num text-xs text-[var(--color-foreground-muted)]">
                        {ex.loadPct}%
                      </span>
                    ) : null}
                  </div>
                  {(ex.tempo || ex.restSec !== undefined || ex.rpeCap !== undefined) && (
                    <div className="text-xs text-[var(--color-foreground-tertiary)] flex flex-wrap gap-x-3">
                      {ex.tempo && <span>Tempo {ex.tempo}</span>}
                      {ex.restSec !== undefined && (
                        <span>
                          Pause{" "}
                          {ex.restSec >= 60
                            ? `${Math.round(ex.restSec / 60)}min`
                            : `${ex.restSec}s`}
                        </span>
                      )}
                      {ex.rpeCap !== undefined && <span>RPE ≤ {ex.rpeCap}</span>}
                    </div>
                  )}
                  {ex.notes && (
                    <p className="text-xs italic text-[var(--color-foreground-muted)]">
                      {ex.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Inline notes */}
      {final.notes && (
        <p className="text-sm italic text-[var(--color-foreground-tertiary)]">
          {final.notes}
        </p>
      )}

      {/* Modulation reasons */}
      {final.modifications.length > 0 && (
        <ul className="flex flex-col gap-1.5 mt-1">
          {final.modifications.map((m, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs text-[var(--color-foreground-tertiary)]"
            >
              <span className="mt-px shrink-0 opacity-50">→</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Low confidence warning */}
      {final.confidence < 70 && (
        <p
          className="text-xs text-[var(--color-foreground-tertiary)]"
          title="Engine-Konfidenz basierend auf Datenqualität und Sensor-Vollständigkeit."
        >
          ⚠ Konfidenz <span className="num">{final.confidence}</span>/100
        </p>
      )}
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
    <div className="flex flex-col">
      {sessions.map((s, i) => {
        const slot = slotLabel(s.type);
        return (
          <div key={i} className="flex flex-col gap-2">
            {i > 0 && <hr className="rule my-6" />}
            {slot && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-foreground-muted)]">
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
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-[0.2em] font-semibold text-[var(--color-foreground-tertiary)]">
          Coach
        </h3>
        <button
          onClick={() => fetchExplanation(true)}
          disabled={loading}
          className="text-[10px] uppercase tracking-wider text-[var(--color-foreground-tertiary)] transition-colors hover:text-[var(--color-foreground-secondary)] disabled:opacity-40"
        >
          {loading ? "…" : "neu"}
        </button>
      </div>

      <div className="text-sm leading-relaxed text-[var(--color-foreground-secondary)]">
        {loading && !aiText && (
          <span className="italic text-[var(--color-foreground-tertiary)]">
            Coach denkt nach…
          </span>
        )}
        {err && <span className="text-[var(--color-destructive)]">{err}</span>}
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
        // Use local date, not UTC — toISOString() gives UTC which is wrong
        // for Berlin after 22:00 UTC (00:00+ Berlin).
        const todayKey = new Date().toLocaleDateString("en-CA");
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

  // Direction-C header: "DIENSTAG" uppercase + "29. April" mono
  const now = new Date();
  const weekdayLong = now.toLocaleDateString("de-DE", { weekday: "long" });
  const dayMonth = now.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8 pb-24">
      {/* Header — uppercase weekday · mono day-month */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          <span className="uppercase">{weekdayLong}</span>
          <span className="text-[var(--color-foreground-tertiary)]"> · </span>
          <span className="num">{dayMonth}</span>
        </h1>
        {today.status === "READY" && (
          <p className="text-[var(--color-foreground-tertiary)] text-xs uppercase tracking-wider">
            Block {today.week.blockNumber} · W{today.week.weekNumber}{" "}
            {prettyPhase(today.week.phaseName)}
            {!shouldShowKneePill(today.sensorOutputs, today.finalSession.type) && (
              <>
                {" · Knie "}
                <span className="num">
                  {today.sensorOutputs.limitations.kneeScoreToday}
                </span>
                /10
              </>
            )}
          </p>
        )}
      </header>

      <hr className="rule mt-4 mb-6" />

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

      {/* Ready: full dashboard, separated by rule lines */}
      {today.status === "READY" && (
        <>
          <RecoveryStrip
            outputs={today.sensorOutputs}
            sessionType={today.finalSession.type}
          />
          <hr className="rule my-6" />

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

          <hr className="rule my-6" />

          <CoachBlock finalSession={today.finalSession} />

          <hr className="rule my-6" />

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
