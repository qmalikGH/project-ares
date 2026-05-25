// Shared UI primitives for training-related components.
// Used by TodayDashboard (slim), WeekView, and other places that render
// SessionPlan / FinalSession data.
"use client";

import * as React from "react";

// ============================================
// Shapes
// ============================================
export type ExerciseShape = {
  name: string;
  sets: number;
  reps: number | string;
  loadPct?: number;
  /** Sprint v0.11: absolute kg, derived from `loadPct × user's 1RM`, snapped to
   * 2.5 kg plates. Filled by `fillAbsoluteLoads` when a 1RM estimate exists. */
  loadAbs?: number;
  rpeCap?: number;
  tempo?: string;
  restSec?: number;
  notes?: string;
  /** Sprint v0.13: true for warmup/ramp-up/activation sets. */
  isWarmup?: boolean;
  /** Sprint v1.6: superset pairing label (e.g. "A1", "B2"). Exercises with the
   *  same supersetGroup are rendered as a grouped block with an amber border. */
  supersetGroup?: string | null;
  supersetOrder?: number | null;
};

export type RunInterval = {
  repeats: number;
  durationMin?: number;
  distanceM?: number;
  paceTarget?: { from: string; to: string };
  restMin?: number;
};

export type RunStructure = {
  warmupMin?: number;
  workIntervals?: RunInterval[];
  cooldownMin?: number;
};

export type SessionShape = {
  date: string | Date;
  type: string;
  durationMin?: number;
  paceTarget?: { from: string; to: string };
  intensityZone?: number;
  rpeTarget?: number;
  exercises?: ExerciseShape[];
  notes?: string;
  hrTarget?: { from: number; to: number };
  controlMethod?: "hr_first" | "pace_first";
  zoneLabel?: string;
  preRunActivation?: ExerciseShape[];
  structure?: RunStructure;
};

export type FinalSessionShape = SessionShape & {
  wasModified: boolean;
  modifications: string[];
  confidence: number;
  explanation: string;
};

// ============================================
// Labels + colors
// ============================================
export const SESSION_LABEL: Record<string, string> = {
  easy_run: "Easy Run",
  threshold_run: "Threshold Run",
  tempo_run: "Tempo Run",
  vo2max_intervals: "VO2max Intervals",
  long_run: "Long Run",
  calibration_run: "Calibration Run",
  time_trial_5k: "5k Time Trial",
  strength_a: "Strength A (Lower-Heavy)",
  strength_b: "Strength B (Upper + Hip)",
  strength_c: "Strength C (Mixed + Plyo)",
  rest: "Rest",
  active_recovery: "Active Recovery",
  cross_training: "Cross-training",
  mobility: "Mobility",
};

export const BAND_COLORS: Record<string, string> = {
  GREEN:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  YELLOW:
    "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 border-yellow-500/30",
  ORANGE:
    "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-500/30",
  RED: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  OPTIMAL:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  LOW: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  HIGH: "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-500/30",
  DANGER: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  BASELINE_BUILDING:
    "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/30",
};

export function prettyPhase(phaseName: string): string {
  const map: Record<string, string> = {
    ACCUMULATION_AEROBIC_BASE: "Aerobic Base",
    ACCUMULATION_THRESHOLD_INTRO: "Threshold Intro",
    TRANSMUTATION_THRESHOLD: "Threshold",
    TRANSMUTATION_VO2MAX: "VO2max",
    REALIZATION_PEAK_PERFORMANCE: "Peak Performance",
  };
  return map[phaseName] ?? phaseName;
}

// ============================================
// Concurrent-training slot ordering
// ============================================
export function slotLabel(type: string): string {
  if (
    type.endsWith("_run") ||
    type === "long_run" ||
    type === "vo2max_intervals" ||
    type === "calibration_run" ||
    type === "time_trial_5k"
  )
    return "AM";
  if (type.startsWith("strength")) return "PM";
  return "";
}

// ============================================
// Card
// ============================================
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border bg-card p-5 shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

// ============================================
// Pill (used by SensorCards on Today)
// ============================================
export function Pill({
  title,
  primary,
  sub,
  band,
  meta,
  tooltip,
}: {
  title: string;
  primary: string;
  sub: string;
  band: string;
  meta: string;
  tooltip?: string;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${BAND_COLORS[band] ?? "border-border bg-muted/30"}`}
      title={tooltip}
    >
      <div className="text-xs uppercase tracking-wide opacity-70">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="num-lg">{primary}</div>
        <div className="text-xs font-semibold uppercase">{sub}</div>
      </div>
      <div className="mt-1 text-xs opacity-80">{meta}</div>
    </div>
  );
}

// ============================================
// Exercise list (Direction C, Sprint v0.11 + Superset-UI Sprint v1.6)
//
// Layout:
//   HEX BAR DEADLIFT                                       (uppercase sans)
//   4 × 5 @ 98 kg                                  82%     (mono, %right)
//   Tempo 3-3-1 · Pause 3min · RPE ≤ 8                     (xs tertiary)
//
// Supersets are grouped with an amber left-border and a "Superset A1" label.
// When `loadAbs` is missing (no 1RM set), falls back to "4 × 5 @ 82%".
// ============================================

// --- Superset grouping logic ---

type ExerciseGroup =
  | { type: "single"; exercises: [ExerciseShape] }
  | { type: "superset"; supersetGroup: string; exercises: ExerciseShape[] };

/** Groups consecutive exercises with the same `supersetGroup` into blocks. */
export function groupBySupersets(exercises: ExerciseShape[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = [];
  let currentSuperset: { supersetGroup: string; exercises: ExerciseShape[] } | null = null;

  for (const ex of exercises) {
    if (ex.supersetGroup) {
      if (currentSuperset && currentSuperset.supersetGroup === ex.supersetGroup) {
        currentSuperset.exercises.push(ex);
      } else {
        // Flush previous superset if any
        if (currentSuperset) {
          groups.push({ type: "superset", ...currentSuperset });
        }
        currentSuperset = { supersetGroup: ex.supersetGroup, exercises: [ex] };
      }
    } else {
      // Flush previous superset if any
      if (currentSuperset) {
        groups.push({ type: "superset", ...currentSuperset });
        currentSuperset = null;
      }
      groups.push({ type: "single", exercises: [ex] });
    }
  }
  // Flush last superset
  if (currentSuperset) {
    groups.push({ type: "superset", ...currentSuperset });
  }

  return groups;
}

// --- Single exercise row (extracted from old ExerciseList) ---

function ExerciseItem({ exercise: ex }: { exercise: ExerciseShape }) {
  return (
    <div className="flex flex-col gap-1">
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
      {(ex.tempo || ex.restSec || ex.rpeCap) && (
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
        <div className="text-xs italic text-[var(--color-foreground-muted)]">
          {ex.notes}
        </div>
      )}
    </div>
  );
}

// --- Main ExerciseList with superset grouping ---

export function ExerciseList({ exercises }: { exercises: ExerciseShape[] }) {
  const groups = groupBySupersets(exercises);

  return (
    <ul className="mt-2 flex flex-col gap-3">
      {groups.map((group, i) =>
        group.type === "superset" ? (
          <li
            key={i}
            className="border-l-2 border-amber-500 pl-3 flex flex-col gap-2 py-1"
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Superset {group.supersetGroup}
            </span>
            {group.exercises.map((ex, j) => (
              <React.Fragment key={j}>
                <ExerciseItem exercise={ex} />
                {j < group.exercises.length - 1 && (
                  <div className="text-center text-[10px] text-[var(--color-foreground-muted)] select-none">
                    ↕
                  </div>
                )}
              </React.Fragment>
            ))}
          </li>
        ) : (
          <li key={i}>
            <ExerciseItem exercise={group.exercises[0]} />
          </li>
        ),
      )}
    </ul>
  );
}

// ============================================
// Session body (run or strength) — used inline + in cards
// ============================================
export function SessionBody({
  final,
  planned,
}: {
  final: FinalSessionShape;
  planned: SessionShape;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xl font-bold">
          {SESSION_LABEL[final.type] ?? final.type}
        </p>
        {final.wasModified && (
          <span className="rounded-full bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 text-xs font-semibold px-2 py-0.5 border border-yellow-500/30 whitespace-nowrap">
            ↻ modulated
          </span>
        )}
      </div>

      {/* HR-First (Sprint v0.7): HR prominent, pace orientierend.
          Pace_first sessions (time trial) flip the hierarchy. */}
      {final.hrTarget && final.controlMethod !== "pace_first" ? (
        <>
          <p className="num-lg mt-2 text-primary">
            HR {final.hrTarget.from}–{final.hrTarget.to}{" "}
            <span className="text-sm font-normal text-muted-foreground">bpm</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {final.durationMin ? `${final.durationMin}min` : "—"}
            {final.paceTarget &&
              ` · Pace ~${final.paceTarget.from}${final.paceTarget.from !== final.paceTarget.to ? `–${final.paceTarget.to}` : ""}/km (orientierend)`}
            {final.intensityZone && ` · Z${final.intensityZone}`}
            {final.rpeTarget && ` · RPE ${final.rpeTarget}`}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground mt-1">
          {final.durationMin ? `${final.durationMin}min` : "—"}
          {final.paceTarget &&
            ` · Pace ${final.paceTarget.from}${final.paceTarget.from !== final.paceTarget.to ? `–${final.paceTarget.to}` : ""}/km`}
          {final.intensityZone && ` · Z${final.intensityZone}`}
          {final.rpeTarget && ` · RPE ${final.rpeTarget}`}
          {final.hrTarget && final.controlMethod === "pace_first" &&
            ` · HR ~${final.hrTarget.from}–${final.hrTarget.to}bpm`}
        </p>
      )}

      {final.notes && (
        <p className="text-sm italic text-muted-foreground mt-1">{final.notes}</p>
      )}

      {final.exercises && final.exercises.length > 0 && (
        <ExerciseList exercises={final.exercises} />
      )}

      {final.wasModified && planned.type !== final.type && (
        <div className="mt-3 text-xs text-muted-foreground">
          (Original geplant: {SESSION_LABEL[planned.type] ?? planned.type})
        </div>
      )}
    </>
  );
}

// ============================================
// SessionCard — single session
// ============================================
export function SessionCard({
  final,
  planned,
}: {
  final: FinalSessionShape;
  planned: SessionShape;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold">Today&apos;s Session</h2>
      </div>
      <div className="mt-3">
        <SessionBody final={final} planned={planned} />
      </div>
      {final.confidence < 70 && (
        <div
          className="mt-4 text-xs text-muted-foreground inline-flex items-center gap-1"
          title="Engine-Konfidenz: zeigt wie sicher die Modulation passt basierend auf Datenqualität, Sensor-Vollständigkeit und Konfliktbehebung. Niedriger Wert = Engine hat mit unvollständigen Daten gearbeitet."
        >
          <span>⚠ Engine-Konfidenz {final.confidence}/100</span>
        </div>
      )}
    </Card>
  );
}

// ============================================
// TodaySessions — wraps multiple sessions per day (two-a-day)
// ============================================
export function TodaySessions({
  finalSessions,
  plannedSessions,
}: {
  finalSessions: FinalSessionShape[];
  plannedSessions: SessionShape[];
}) {
  const meaningful = finalSessions.filter((s) => s.type !== "rest");
  const visible = meaningful.length > 0 ? meaningful : finalSessions;

  if (visible.length === 1) {
    const planned =
      plannedSessions.find((p) => p.type === visible[0].type) ?? plannedSessions[0];
    return <SessionCard final={visible[0]} planned={planned} />;
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Today&apos;s Sessions</h2>
      <div className="flex flex-col gap-4 divide-y">
        {visible.map((s, i) => {
          const planned =
            plannedSessions.find((p) => p.type === s.type) ??
            plannedSessions[i] ??
            plannedSessions[0];
          const slot = slotLabel(s.type);
          return (
            <div key={i} className={i > 0 ? "pt-4" : ""}>
              {slot && (
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                  {slot}
                </div>
              )}
              <SessionBody final={s} planned={planned} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
