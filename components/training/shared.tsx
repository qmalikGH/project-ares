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
  rpeCap?: number;
  tempo?: string;
  restSec?: number;
  notes?: string;
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
        <div className="text-2xl font-bold tabular-nums">{primary}</div>
        <div className="text-xs font-semibold uppercase">{sub}</div>
      </div>
      <div className="mt-1 text-xs opacity-80">{meta}</div>
    </div>
  );
}

// ============================================
// Exercise list (rendered for both Today + WeekView expand)
// ============================================
export function ExerciseList({ exercises }: { exercises: ExerciseShape[] }) {
  return (
    <ul className="mt-3 space-y-2 text-sm border-t pt-3">
      {exercises.map((ex, i) => (
        <li key={i} className="flex flex-col gap-0.5">
          <div className="flex justify-between gap-2">
            <span className="font-medium">{ex.name}</span>
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">
              {ex.sets} × {ex.reps}
              {ex.loadPct ? ` @ ${ex.loadPct}%` : ""}
            </span>
          </div>
          {(ex.tempo || ex.restSec || ex.rpeCap) && (
            <div className="text-xs text-muted-foreground/80 flex flex-wrap gap-x-3">
              {ex.tempo && <span>Tempo {ex.tempo}</span>}
              {ex.restSec !== undefined && (
                <span>
                  Pause{" "}
                  {ex.restSec >= 60
                    ? `${Math.round(ex.restSec / 60)}min`
                    : `${ex.restSec}s`}
                </span>
              )}
              {ex.rpeCap !== undefined && <span>RPE-Cap {ex.rpeCap}</span>}
            </div>
          )}
          {ex.notes && (
            <div className="text-xs italic text-muted-foreground">{ex.notes}</div>
          )}
        </li>
      ))}
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
      <p className="text-sm text-muted-foreground mt-1">
        {final.durationMin ? `${final.durationMin}min` : "—"}
        {final.paceTarget &&
          ` · Pace ${final.paceTarget.from}${final.paceTarget.from !== final.paceTarget.to ? `–${final.paceTarget.to}` : ""}/km`}
        {final.intensityZone && ` · Z${final.intensityZone}`}
        {final.rpeTarget && ` · RPE ${final.rpeTarget}`}
      </p>
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
