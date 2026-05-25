"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CompletionFlow } from "@/components/workout/CompletionFlow";
import {
  SESSION_LABEL,
  prettyPhase,
  slotLabel,
  groupBySupersets,
} from "@/components/training/shared";
import type {
  ExerciseShape,
  FinalSessionShape,
  RunStructure,
  SessionShape,
} from "@/components/training/shared";
import { WeekStrip } from "@/components/training/WeekStrip";
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
      macrocycleEvaluated: boolean;
      totalWeeks: number;
      currentWeightKg: number | null;
    }
  | { status: "NO_ACTIVE_PLAN" | "NO_WEEK_PLAN" | "NO_SESSION_TODAY" };

type WorkoutState = { id: string; status: string } | null;

/** Sprint v0.11+: per-session-type Workout state. Two-a-days have one entry
 * per session ('easy_run' + 'strength_a' on Mondays). Empty record = no
 * Workout rows yet today. */
type WorkoutStateMap = Record<string, WorkoutState>;

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
  bgTint,
}: {
  label: string;
  value: string;
  sub?: string;
  toneColor?: string;
  bgTint?: string;
}) {
  return (
    <div
      className="cell"
      style={{
        "--rec-tone": toneColor ?? "var(--color-border)",
        "--rec-bg": bgTint ?? "rgba(255,255,255,0.025)",
      } as React.CSSProperties}
    >
      <span className="label">{label}</span>
      <span
        className="v num"
        style={toneColor ? { color: toneColor } : undefined}
      >
        {value}
      </span>
      {sub && (
        <span className="label" style={{ opacity: 0.7 }}>{sub}</span>
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

/** Sprint v0.11+1: subtle 8% bg-tint matching the band's tone color, used as
 * a tile-fill so YELLOW Readiness etc. is visible at a glance instead of
 * relying on the small sub-label. Returns undefined for neutral bands so the
 * tile falls back to the default 3%-white fill. */
function bandToBgTint(band: string): string | undefined {
  switch (band) {
    case "RED":
    case "DANGER":
      return "rgba(194, 91, 91, 0.10)";
    case "ORANGE":
    case "HIGH":
      return "rgba(212, 168, 83, 0.10)";
    case "YELLOW":
      return "rgba(212, 168, 83, 0.08)";
    case "GREEN":
    case "OPTIMAL":
      return "rgba(107, 191, 123, 0.08)";
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
    <div className="recovery">
      <RecoveryMetric
        label="Readiness"
        value={String(outputs.readiness.score)}
        sub={outputs.readiness.band}
        toneColor={bandToToneColor(outputs.readiness.band)}
        bgTint={bandToBgTint(outputs.readiness.band)}
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
        bgTint={bandToBgTint(acwr.band)}
      />
      {showKnee ? (
        <RecoveryMetric
          label="Knee"
          value={String(outputs.limitations.kneeScoreToday)}
          sub={outputs.limitations.therapyPhase}
          toneColor={bandToToneColor(kneeKey)}
          bgTint={bandToBgTint(kneeKey)}
        />
      ) : (
        <RecoveryMetric
          label="HRV"
          value={outputs.readiness.components.hrv != null ? String(Math.round(outputs.readiness.components.hrv)) : "—"}
          sub={outputs.readiness.trend7d}
          toneColor={bandToToneColor(outputs.readiness.band)}
          bgTint={bandToBgTint(outputs.readiness.band)}
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

function RunStructureRows({ structure, color }: { structure: RunStructure; color: string }) {
  return (
    <div className="flex flex-col gap-0" style={{ marginTop: 8 }}>
      {structure.warmupMin != null && (
        <div className="flex items-baseline justify-between py-2" style={{ borderLeft: `2px solid ${color}`, paddingLeft: 12, opacity: 0.8 }}>
          <span className="text-sm">Einlaufen</span>
          <span className="num text-sm text-[var(--color-foreground-muted)]">{structure.warmupMin} min</span>
        </div>
      )}
      {structure.workIntervals?.map((iv, i) => (
        <div key={i} className="flex items-baseline justify-between py-2" style={{ borderLeft: `2px solid ${color}`, paddingLeft: 12 }}>
          <span className="text-sm">
            {iv.repeats} × {iv.durationMin ? `${iv.durationMin} min` : iv.distanceM ? `${iv.distanceM}m` : ""}
            {iv.paceTarget && <span className="text-[var(--color-foreground-muted)]"> @ {iv.paceTarget.from === iv.paceTarget.to ? iv.paceTarget.from : `${iv.paceTarget.from}–${iv.paceTarget.to}`}</span>}
          </span>
          {iv.restMin != null && (
            <span className="num text-sm text-[var(--color-foreground-muted)]">{iv.restMin} min Trab</span>
          )}
        </div>
      ))}
      {structure.cooldownMin != null && (
        <div className="flex items-baseline justify-between py-2" style={{ borderLeft: `2px solid ${color}`, paddingLeft: 12, opacity: 0.8 }}>
          <span className="text-sm">Auslaufen</span>
          <span className="num text-sm text-[var(--color-foreground-muted)]">{structure.cooldownMin} min</span>
        </div>
      )}
    </div>
  );
}

// Sprint v1.6: Strength exercise list with superset grouping + weight ratios.
// Extracted from SessionHeroCard's inline rendering for maintainability.
function StrengthExerciseListInline({
  exercises,
  currentWeightKg,
}: {
  exercises: ExerciseShape[];
  currentWeightKg?: number | null;
}) {
  // Separate warmups from work sets, then group work sets by superset.
  const warmups = exercises.filter((e) => e.isWarmup);
  const workSets = exercises.filter((e) => !e.isWarmup);
  const groups = groupBySupersets(workSets);

  return (
    <ul className="flex flex-col gap-3 mt-1">
      {/* Warmups first (compact, ungrouped) */}
      {warmups.map((ex, i) => {
        const prevEx = i > 0 ? warmups[i - 1] : null;
        const isFirstWarmup = !prevEx || prevEx.name !== ex.name;
        return (
          <li key={`wu-${i}`} className="flex flex-col gap-0.5">
            {isFirstWarmup && <span className="label">Warmup · {ex.name}</span>}
            <div className="flex items-baseline gap-2 text-[var(--color-foreground-muted)]">
              <span className="num text-xs">
                {ex.sets}×{ex.reps}
                {ex.loadAbs !== undefined && ex.loadAbs > 0 ? <> @ {ex.loadAbs} kg</> : ex.loadPct ? <> @ {ex.loadPct}%</> : null}
              </span>
              {ex.rpeCap !== undefined && <span className="text-[10px]">RPE ≤{ex.rpeCap}</span>}
            </div>
          </li>
        );
      })}

      {/* Work sets — grouped by superset */}
      {groups.map((group, gi) =>
        group.type === "superset" ? (
          <li key={`ss-${gi}`} className="border-l-2 border-amber-500 pl-3 flex flex-col gap-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Superset {group.supersetGroup}
            </span>
            {group.exercises.map((ex, j) => (
              <div key={j}>
                <InlineExerciseRow ex={ex} currentWeightKg={currentWeightKg} />
                {j < group.exercises.length - 1 && (
                  <div className="text-center text-[10px] text-[var(--color-foreground-muted)] select-none mt-1">↕</div>
                )}
              </div>
            ))}
          </li>
        ) : (
          <li key={`s-${gi}`}>
            <InlineExerciseRow ex={group.exercises[0]} currentWeightKg={currentWeightKg} />
          </li>
        ),
      )}
    </ul>
  );
}

function InlineExerciseRow({ ex, currentWeightKg }: { ex: ExerciseShape; currentWeightKg?: number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-foreground-secondary)]">
        {ex.name}
      </span>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num-md text-[var(--color-foreground)]">
          {ex.sets} × {ex.reps}
          {ex.loadAbs !== undefined && ex.loadAbs > 0 ? (
            <><span className="text-[var(--color-foreground-tertiary)]">{" @ "}</span>{ex.loadAbs} kg</>
          ) : ex.loadPct ? (
            <><span className="text-[var(--color-foreground-tertiary)]">{" @ "}</span>{ex.loadPct}%</>
          ) : null}
        </span>
        {ex.loadAbs !== undefined && ex.loadAbs > 0 && ex.loadPct ? (
          <span className="num text-xs text-[var(--color-foreground-muted)]">
            {ex.loadPct}%
            {currentWeightKg && currentWeightKg > 0 && (
              <span className="ml-1 text-[var(--color-session-calibration)]">
                · {(ex.loadAbs / currentWeightKg).toFixed(2)}×
              </span>
            )}
          </span>
        ) : null}
      </div>
      {(ex.tempo || ex.restSec !== undefined || ex.rpeCap !== undefined) && (
        <div className="text-xs text-[var(--color-foreground-tertiary)] flex flex-wrap gap-x-3">
          {ex.tempo && <span>Tempo {ex.tempo}</span>}
          {ex.restSec !== undefined && <span>Pause {ex.restSec >= 60 ? `${Math.round(ex.restSec / 60)}min` : `${ex.restSec}s`}</span>}
          {ex.rpeCap !== undefined && <span>RPE ≤ {ex.rpeCap}</span>}
        </div>
      )}
      {ex.notes && <p className="text-xs italic text-[var(--color-foreground-muted)]">{ex.notes}</p>}
    </div>
  );
}

function SessionHeroCard({
  final,
  workoutState,
  currentWeightKg,
}: {
  final: FinalSessionShape;
  workoutState: WorkoutState;
  currentWeightKg?: number | null;
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

  const stripeColor = isRest ? "var(--color-session-easy)" : color.color;
  const stripeBg = isRest ? "var(--color-session-easy-bg)" : color.bg;
  const titleColor = isRest ? "var(--color-session-easy)" : color.color;

  const zoneChipText = final.zoneLabel
    ? `Z${final.intensityZone ?? ""} · ${final.zoneLabel}`
    : final.intensityZone
    ? `Z${final.intensityZone}`
    : null;

  return (
    <div
      className="hero-stripe flex flex-col gap-3"
      style={{
        borderLeftColor: stripeColor,
        background: `linear-gradient(90deg, color-mix(in srgb, ${stripeColor} 18%, transparent), transparent 70%)`,
      }}
    >
      {/* Title row: session label left, zone chip right */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="label" style={{ color: titleColor, margin: 0 }}>
            {SESSION_LABEL[final.type] ?? final.type}
          </span>
          {status === "in_progress" && (
            <span className="label" style={{ color: "var(--color-success)", margin: 0 }}>· Live</span>
          )}
          {status === "completed" && (
            <span className="label" style={{ color: "var(--color-success)", margin: 0 }}>✓</span>
          )}
          {final.wasModified && (
            <span className="label" style={{ color: "var(--color-warning)", margin: 0 }}>↻</span>
          )}
        </div>
        {!isStrength && zoneChipText && (
          <span className="chip" style={{ backgroundColor: color.bg, color: color.color }}>
            {zoneChipText}
          </span>
        )}
      </div>

      {/* Rest day */}
      {isRest && (
        <>
          <span className="num-md uppercase tracking-[0.04em]" style={{ color: titleColor }}>
            Ruhetag
          </span>
          <p className="text-sm text-[var(--color-foreground-secondary)] leading-relaxed">
            Recovery ist Training. Heute kein geplanter Workout.
            {final.notes ? ` ${final.notes}` : " Optional: 15–20 min Mobility."}
          </p>
        </>
      )}

      {/* Hero number: HR or Pace */}
      {!isRest && !isStrength && (
        <>
          {!isPaceFirst && final.hrTarget ? (
            <div className="flex items-baseline gap-3">
              <span className="num-hero" style={{ color: color.color }}>
                {final.hrTarget.from}–{final.hrTarget.to}
              </span>
              <span className="text-base text-[var(--color-foreground-tertiary)]">bpm</span>
            </div>
          ) : paceDisplay ? (
            <div className="flex items-baseline gap-3">
              <span className="num-hero" style={{ color: color.color }}>
                {paceDisplay}
              </span>
              <span className="text-base text-[var(--color-foreground-tertiary)]">/km</span>
            </div>
          ) : null}

          {/* Sub-line: duration · pace · RPE */}
          <p className="num text-sm text-[var(--color-foreground-secondary)]">
            {final.durationMin && <>{final.durationMin} min</>}
            {!isPaceFirst && final.hrTarget && paceDisplay && <> · {paceDisplay} /km</>}
            {final.rpeTarget != null && <> · RPE {final.rpeTarget}</>}
          </p>
        </>
      )}

      {/* Run structure rows (Einlaufen / Intervalle / Auslaufen) */}
      {!isStrength && !isRest && final.structure && (
        <RunStructureRows structure={final.structure} color={stripeColor} />
      )}

      {/* Pre-Run Activation (only when no structure is available) */}
      {!isStrength && !isRest && !final.structure && final.preRunActivation && final.preRunActivation.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          <span className="label">Pre-Run Activation (5 min)</span>
          <ul className="flex flex-col gap-1.5">
            {final.preRunActivation.map((ex, i) => (
              <li key={i} className="flex items-baseline justify-between text-[var(--color-foreground-muted)]">
                <span className="text-xs">{ex.name}</span>
                <span className="num text-[10px]">{ex.sets}×{ex.reps}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Strength: exercise list */}
      {isStrength && (
        <>
          {final.durationMin && (
            <p className="num text-sm text-[var(--color-foreground-secondary)]">
              {final.durationMin} min
              {final.exercises && <> · {final.exercises.filter(e => !e.isWarmup).length} ex</>}
            </p>
          )}
          {final.exercises && final.exercises.length > 0 && (
            <StrengthExerciseListInline
              exercises={final.exercises}
              currentWeightKg={currentWeightKg}
            />
          )}
        </>
      )}

      {/* Notes */}
      {!isRest && final.notes && (
        <p className="text-sm italic text-[var(--color-foreground-tertiary)]">{final.notes}</p>
      )}

      {/* Modulation reasons */}
      {final.modifications.length > 0 && (
        <ul className="flex flex-col gap-1 mt-1">
          {final.modifications.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-foreground-tertiary)]">
              <span className="mt-px shrink-0 opacity-50">→</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}

      {final.confidence < 70 && (
        <p className="text-xs text-[var(--color-foreground-tertiary)]">
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
  workoutMap,
  onChanged,
  onWorkoutStateChange,
  currentWeightKg,
}: {
  finalSessions: FinalSessionShape[];
  workoutMap: WorkoutStateMap;
  onChanged: () => void;
  onWorkoutStateChange: (sessionType: string, ws: WorkoutState) => void;
  currentWeightKg?: number | null;
}) {
  const meaningful = finalSessions.filter((s) => s.type !== "rest");
  const sessions = meaningful.length > 0 ? meaningful : finalSessions;

  return (
    <div className="flex flex-col">
      {sessions.map((s, i) => {
        const sessionWorkout = workoutMap[s.type] ?? null;
        const isLater = i > 0;
        const sessionColor = getSessionColor(s.type);
        return (
          <div key={i} className="flex flex-col">
            {isLater && (
              <>
                <div style={{ height: 20 }} />
                <div className="section-h">
                  <span className="label">Heute Später</span>
                </div>
                <div style={{ height: 10 }} />
                <SessionHeroCard final={s} workoutState={sessionWorkout} currentWeightKg={currentWeightKg} />
                <div style={{ height: 16 }} />
                <ActionsZone
                  onChanged={onChanged}
                  sessionType={s.type}
                  plannedExercises={s.exercises ?? []}
                  plannedDurationMin={s.durationMin ?? 45}
                  workoutState={sessionWorkout}
                  onWorkoutStateChange={(ws) => onWorkoutStateChange(s.type, ws)}
                />
              </>
            )}
            {!isLater && (
              <>
                <SessionHeroCard final={s} workoutState={sessionWorkout} currentWeightKg={currentWeightKg} />
                <div style={{ height: 16 }} />
                <ActionsZone
                  onChanged={onChanged}
                  sessionType={s.type}
                  plannedExercises={s.exercises ?? []}
                  plannedDurationMin={s.durationMin ?? 45}
                  workoutState={sessionWorkout}
                  onWorkoutStateChange={(ws) => onWorkoutStateChange(s.type, ws)}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Sprint v0.12: CoachBlock removed. The auto-generated daily coach text on
// /today is replaced with a "Workout anpassen →" link to /coach. The coach
// is now an action-oriented tool surface (substitute_exercise,
// adjust_run_volume, set_therapy_phase, skip_session) — no more proactive
// daily summaries that cost tokens for content the user rarely reads.

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
  // Sprint v0.15: optional body weight
  const [weightInput, setWeightInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const bodyWeightKg = weightInput.trim() ? Number(weightInput) : undefined;
      if (bodyWeightKg !== undefined && (!Number.isFinite(bodyWeightKg) || bodyWeightKg < 40 || bodyWeightKg > 200)) {
        setErr("Gewicht muss zwischen 40 und 200 kg liegen.");
        setSubmitting(false);
        return;
      }
      const res = await fetch("/api/sensors/morning-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectiveRecovery, morningStiffness, stairsScore, bodyWeightKg }),
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

        {/* Sprint v0.15: optional body weight input */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              Körpergewicht
            </label>
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              optional
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={40}
              max={200}
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              placeholder="—"
              className="num w-28 rounded-md border border-[var(--border-subtle)] bg-white/[0.04] px-3 py-2 text-right text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <span className="text-sm text-[var(--text-tertiary)]">kg</span>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">
            Gym-Waage oder Schätzung. Muss nicht täglich sein.
          </p>
        </div>
      </div>

      {err && <p className="mt-4 text-sm text-red-400">{err}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="btn-primary mt-6"
        style={{ opacity: submitting ? 0.6 : 1 }}
      >
        {submitting ? "Berechne…" : "Session berechnen"}
      </button>
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
    return null;
  }

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sending the type makes the API target the right Workout row on
        // two-a-days (run vs strength stay independent).
        body: JSON.stringify({ type: sessionType }),
      });
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
      <p className="text-xs uppercase tracking-[0.18em] font-semibold text-[var(--color-success)]">
        ✓ Session abgeschlossen
      </p>
    );
  }

  if (workoutState?.status === "in_progress") {
    return (
      <section className="flex flex-col gap-3">
        <h3 className="text-xs uppercase tracking-[0.2em] font-semibold text-[var(--color-foreground-tertiary)]">
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
      <button onClick={start} disabled={busy} className="btn-primary" style={{ opacity: busy ? 0.6 : 1 }}>
        {busy ? "Starte…" : "Session starten"}
      </button>
      {err && (
        <p className="mt-2 text-sm text-[var(--color-destructive)]">{err}</p>
      )}
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
  const [workoutMap, setWorkoutMap] = useState<WorkoutStateMap>({});

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

  // Fetch today's workout state — one entry per session-type so two-a-days
  // (easy_run + strength_a) keep separate hero badges.
  const refreshWorkoutMap = useCallback(() => {
    fetch("/api/workouts?days=1")
      .then((r) => r.json())
      .then((data) => {
        // Use local date, not UTC — toISOString() gives UTC which is wrong
        // for Berlin after 22:00 UTC (00:00+ Berlin).
        const todayKey = new Date().toLocaleDateString("en-CA");
        const list =
          (data.workouts as
            | { id: string; date: string; status: string; type: string }[]
            | undefined) ?? [];
        const map: WorkoutStateMap = {};
        for (const w of list) {
          if (w.date.slice(0, 10) !== todayKey) continue;
          map[w.type] = { id: w.id, status: w.status };
        }
        setWorkoutMap(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshWorkoutMap();
  }, [refreshWorkoutMap]);

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

  // Live-mode: extracted dashboard inner so 3 variants can reference the same
  // content tree with different scoped CSS spacing rules. The original keeps
  // its baseline className; variants override via scoped CSS variables.
  const dashboardInner = (
    <>
      {/* Appbar — design prototype pattern */}
      <div className="appbar" style={{ padding: 0 }}>
        <div className="left">
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Heute</h1>
            <div className="sub">
              <span className="num">{dayMonth}</span>
              {today.status === "READY" && (
                <>
                  {" · Block "}
                  <span className="num">{today.week.blockNumber}</span>
                  {" · W"}
                  <span className="num">{today.week.weekNumber}</span>
                  {" · "}
                  {prettyPhase(today.week.phaseName)}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

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

      {/* Ready: full dashboard — design prototype hierarchy */}
      {today.status === "READY" && (
        <>
          {today.week.weekNumber >= 17 && !today.macrocycleEvaluated && (
            <div className="mb-6 flex items-center justify-between rounded-lg border-l-4 border-[var(--color-session-calibration)] bg-[var(--color-session-calibration)]/8 px-4 py-3">
              <div>
                <p className="label" style={{ color: "var(--color-session-calibration)" }}>
                  Makrozyklus abgeschlossen
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-foreground-secondary)]">
                  Evaluiere deinen Fortschritt und starte den nächsten Zyklus.
                </p>
              </div>
              <Link
                href="/goals/evaluate"
                className="shrink-0 rounded-md bg-[var(--color-session-calibration)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--color-session-calibration)] hover:bg-[var(--color-session-calibration)]/25 transition-colors"
              >
                Evaluieren →
              </Link>
            </div>
          )}

          {/* Session hero — stripe treatment */}
          {(today.finalSessions?.length ?? 0) > 1 ? (
            <TwoADaySection
              finalSessions={today.finalSessions!}
              workoutMap={workoutMap}
              onChanged={() => {
                refresh();
                refreshWorkoutMap();
              }}
              onWorkoutStateChange={(type, ws) =>
                setWorkoutMap((prev) => ({ ...prev, [type]: ws }))
              }
              currentWeightKg={today.currentWeightKg}
            />
          ) : (
            <>
              <SessionHeroCard
                final={today.finalSession}
                workoutState={workoutMap[today.finalSession.type] ?? null}
                currentWeightKg={today.currentWeightKg}
              />
            </>
          )}

          <div style={{ height: 20 }} />

          {/* WeekStrip */}
          <WeekStrip />

          {/* Secondary session for single-session days shows below weekstrip */}

          <div style={{ height: 20 }} />

          {/* CTA: Session starten */}
          {(() => {
            const primaryType = today.finalSession.type;
            const primaryWs = workoutMap[primaryType] ?? null;
            if ((today.finalSessions?.length ?? 0) <= 1) {
              return (
                <ActionsZone
                  onChanged={() => { refresh(); refreshWorkoutMap(); }}
                  sessionType={primaryType}
                  plannedExercises={today.finalSession.exercises ?? []}
                  plannedDurationMin={today.finalSession.durationMin ?? 45}
                  workoutState={primaryWs}
                  onWorkoutStateChange={(ws) =>
                    setWorkoutMap((prev) => ({ ...prev, [primaryType]: ws }))
                  }
                />
              );
            }
            return null;
          })()}

          <div style={{ height: 20 }} />

          {/* Recovery section */}
          <div className="section-h">
            <span className="label">Recovery</span>
          </div>
          <div style={{ height: 10 }} />
          <RecoveryStrip
            outputs={today.sensorOutputs}
            sessionType={today.finalSession.type}
          />

          <div style={{ height: 20 }} />

          {/* Coach line */}
          <hr className="rule" />
          <div className="coach">
            <div className="avatar">A</div>
            <div>
              <p className="msg" style={{ margin: 0 }}>
                {today.sensorOutputs.load.band === "HIGH" ? (
                  <>ACWR erhöht. Heute moderate Intensität halten.</>
                ) : today.sensorOutputs.readiness.band === "RED" || today.sensorOutputs.readiness.band === "DANGER" ? (
                  <>Readiness niedrig. Überlege ob heute leichter trainiert wird.</>
                ) : (
                  <>Alles im grünen Bereich. Session wie geplant.</>
                )}
              </p>
              <Link href="/coach" className="link">
                Anpassen →
              </Link>
            </div>
          </div>
          <hr className="rule" />
        </>
      )}
    </>
  );

  return (
    <div className="today-dashboard mx-auto flex w-full max-w-3xl flex-col px-6">
      {dashboardInner}
    </div>
  );
}
