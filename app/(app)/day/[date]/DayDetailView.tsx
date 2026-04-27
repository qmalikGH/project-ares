"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  ExerciseList,
  SESSION_LABEL,
  prettyPhase,
  type ExerciseShape,
  type SessionShape,
} from "@/components/training/shared";

type Position = "past" | "today" | "future";

type Workout = {
  id: string;
  type: string;
  status: string;
  plannedSession: SessionShape;
  executedSession: unknown;
  modulationApplied: boolean;
  modulations: string[] | null;
  modulationReason: string | null;
  rpe: number | null;
  durationActualMin: number | null;
  notes: string | null;
  garminActivityId: string | null;
};

type SensorData = {
  garmin: {
    hrvRmssd?: number;
    sleepScore?: number;
    sleepDurationMin?: number;
    bodyBatteryMorning?: number;
    rhr?: number;
  } | null;
  userMorning: {
    subjectiveRecovery?: number;
    morningStiffness?: number;
    stairsScore?: number;
    postSessionScore?: number;
  } | null;
  readinessScore: number | null;
  readinessBand: string | null;
  kneeScore: number | null;
  therapyPhase: string | null;
};

type DayResponse =
  | { error: string }
  | {
      status: "ok";
      date: string;
      position: Position;
      workouts: Workout[];
      plannedFromWeeklyPlan: SessionShape[];
      sensor: SensorData | null;
      blockPosition: {
        blockNumber: number;
        phaseName: string;
        phaseId: string;
      } | null;
    };

type RunSplit = {
  splitNumber: number;
  distanceM: number;
  durationSec: number;
  paceSecPerKm: number | null;
  averageHr: number | null;
  maxHr: number | null;
};

type RunExecuted = {
  type: "run";
  source: "garmin_import" | "manual";
  garminActivityId: number | null;
  startTimeLocal: string;
  durationSec: number;
  distanceM: number | null;
  averagePaceSecPerKm: number | null;
  averageHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  calories: number | null;
  splits: RunSplit[];
};

type StrengthExecuted = {
  type: "strength";
  source: "manual";
  startTimeLocal: string;
  durationActualMin: number;
  averageHr: number | null;
  maxHr: number | null;
  calories: number | null;
  exercises: Array<{
    name: string;
    plannedSets: number;
    plannedReps: number | string;
    plannedLoadPct: number | null;
    actualSets: Array<{
      reps: number;
      loadKg: number | null;
      rpe: number | null;
      durationSec: number | null;
    }>;
    skipped: boolean;
    exerciseNotes?: string;
  }>;
};

export default function DayDetailView({ date }: { date: string }) {
  const [data, setData] = useState<DayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/day/${date}`)
      .then((r) => r.json())
      .then((d) => setData(d as DayResponse))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [date]);

  if (error)
    return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  if (!data)
    return (
      <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>
    );
  if ("error" in data) {
    return (
      <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{data.error}</p>
    );
  }

  const dateObj = new Date(`${date}T00:00:00Z`);
  const dateLabel = dateObj.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const positionBadge: Record<Position, { label: string; cls: string }> = {
    past: {
      label: "Vergangen",
      cls: "bg-slate-500/10 text-slate-700 dark:text-slate-400",
    },
    today: {
      label: "Heute",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    },
    future: {
      label: "Geplant",
      cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    },
  };
  const badge = positionBadge[data.position];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dateLabel}</h1>
          {data.blockPosition && (
            <p className="text-sm text-muted-foreground">
              Block {data.blockPosition.blockNumber} ·{" "}
              {prettyPhase(data.blockPosition.phaseName)}
            </p>
          )}
        </div>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${badge.cls}`}>
          {badge.label}
        </span>
      </header>

      {data.position === "today" && (
        <Card>
          <Link
            href="/today"
            className="text-sm text-primary hover:underline"
          >
            → Zurück zu /today für volle Live-Ansicht
          </Link>
        </Card>
      )}

      {/* Sensor snapshot for past/today */}
      {(data.position === "past" || data.position === "today") && data.sensor && (
        <SensorSnapshotCard sensor={data.sensor} />
      )}

      {/* Workouts (past/today) or planned (future) */}
      {data.position === "future" ? (
        <FuturePlanCard sessions={data.plannedFromWeeklyPlan} />
      ) : (
        <PastWorkoutsCard workouts={data.workouts} />
      )}
    </div>
  );
}

// ============================================
// Sensor snapshot
// ============================================
function SensorSnapshotCard({ sensor }: { sensor: SensorData }) {
  const g = sensor.garmin ?? {};
  const u = sensor.userMorning ?? {};

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Sensor-Daten</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <SensorCell label="Readiness" value={sensor.readinessScore} sub={sensor.readinessBand ?? undefined} unit="/100" />
        <SensorCell label="HRV" value={g.hrvRmssd ?? null} unit="ms" />
        <SensorCell
          label="Sleep"
          value={g.sleepScore ?? null}
          sub={
            g.sleepDurationMin
              ? `${Math.floor(g.sleepDurationMin / 60)}h ${g.sleepDurationMin % 60}min`
              : undefined
          }
          unit="/100"
        />
        <SensorCell label="Body Battery" value={g.bodyBatteryMorning ?? null} unit="/100" />
        <SensorCell label="RHR" value={g.rhr ?? null} unit="bpm" />
        <SensorCell label="Subjective" value={u.subjectiveRecovery ?? null} unit="/10" />
        <SensorCell
          label="Knee Score"
          value={sensor.kneeScore ?? null}
          sub={sensor.therapyPhase ?? undefined}
          unit="/10"
        />
        <SensorCell label="Stiffness" value={u.morningStiffness ?? null} unit="/10" />
        <SensorCell label="Stairs" value={u.stairsScore ?? null} unit="/10" />
      </div>
    </Card>
  );
}

function SensorCell({
  label,
  value,
  sub,
  unit,
}: {
  label: string;
  value: number | null;
  sub?: string;
  unit: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">
        {value != null ? `${value}${unit}` : "—"}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ============================================
// Past/Today workouts
// ============================================
function PastWorkoutsCard({ workouts }: { workouts: Workout[] }) {
  if (workouts.length === 0) {
    return (
      <Card>
        <p className="text-muted-foreground">Keine Sessions an diesem Tag.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {workouts.map((w) => (
        <WorkoutDetailCard key={w.id} workout={w} />
      ))}
    </div>
  );
}

function WorkoutDetailCard({ workout }: { workout: Workout }) {
  const planned = workout.plannedSession;
  const exercises = (planned.exercises as ExerciseShape[] | undefined) ?? [];
  const executed = workout.executedSession as
    | RunExecuted
    | StrengthExecuted
    | null;

  return (
    <Card>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">
          {SESSION_LABEL[workout.type] ?? workout.type}
        </h2>
        <StatusBadge status={workout.status} modulated={workout.modulationApplied} />
      </header>

      {/* Plan vs Executed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Plan
          </p>
          <p>
            {planned.durationMin && `${planned.durationMin}min`}
            {planned.paceTarget &&
              ` · ${planned.paceTarget.from}${planned.paceTarget.from !== planned.paceTarget.to ? `–${planned.paceTarget.to}` : ""}/km`}
            {planned.intensityZone && ` · Z${planned.intensityZone}`}
            {planned.rpeTarget != null && ` · RPE ${planned.rpeTarget}`}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Tatsächlich
          </p>
          <p>
            {workout.durationActualMin
              ? `${workout.durationActualMin}min`
              : "—"}
            {workout.rpe != null && ` · RPE ${workout.rpe}`}
          </p>
        </div>
      </div>

      {/* Modulationen */}
      {workout.modulationApplied &&
        workout.modulations &&
        workout.modulations.length > 0 && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Modulationen
            </p>
            <ul className="list-disc pl-4 text-xs space-y-0.5">
              {workout.modulations.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

      {/* Run executed details: pace, HR, splits */}
      {executed?.type === "run" && (
        <RunExecutedDetail run={executed} />
      )}

      {/* Strength executed: per-exercise actual sets */}
      {executed?.type === "strength" && (
        <StrengthExecutedDetail strength={executed} />
      )}

      {/* Plan exercises (if no executed strength) */}
      {executed?.type !== "strength" && exercises.length > 0 && (
        <ExerciseList exercises={exercises} />
      )}

      {/* Notes */}
      {workout.notes && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Notizen
          </p>
          <p className="italic text-sm">{workout.notes}</p>
        </div>
      )}

      {/* Garmin link */}
      {workout.garminActivityId && (
        <div className="mt-4">
          <a
            href={`https://connect.garmin.com/modern/activity/${workout.garminActivityId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            → in Garmin Connect öffnen
          </a>
        </div>
      )}
    </Card>
  );
}

function StatusBadge({
  status,
  modulated,
}: {
  status: string;
  modulated: boolean;
}) {
  if (status === "completed" && !modulated) {
    return (
      <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-semibold px-2 py-0.5 border border-emerald-500/30">
        ✓ Completed
      </span>
    );
  }
  if (status === "completed" && modulated) {
    return (
      <span className="rounded-md bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 text-xs font-semibold px-2 py-0.5 border border-yellow-500/30">
        ↻ Modulated
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="rounded-md bg-red-500/15 text-red-700 dark:text-red-400 text-xs font-semibold px-2 py-0.5 border border-red-500/30">
        ✗ Skipped
      </span>
    );
  }
  return (
    <span className="rounded-md bg-muted text-muted-foreground text-xs font-semibold px-2 py-0.5 border">
      {status}
    </span>
  );
}

function RunExecutedDetail({ run }: { run: RunExecuted }) {
  const km = run.distanceM != null ? (run.distanceM / 1000).toFixed(2) : "—";
  const pace = run.averagePaceSecPerKm
    ? `${Math.floor(run.averagePaceSecPerKm / 60)}:${String(run.averagePaceSecPerKm % 60).padStart(2, "0")}/km`
    : "—";

  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
        Garmin {run.source === "garmin_import" ? "Import" : "Manual"}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Distanz" value={km} unit={run.distanceM != null ? "km" : ""} />
        <Stat label="Pace" value={pace} unit="" />
        <Stat label="Avg HR" value={run.averageHr ?? "—"} unit={run.averageHr ? "bpm" : ""} />
        <Stat label="Max HR" value={run.maxHr ?? "—"} unit={run.maxHr ? "bpm" : ""} />
      </div>
      {run.elevationGainM != null && run.elevationGainM > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Höhenmeter: {run.elevationGainM}m
        </p>
      )}

      {run.splits.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Splits
          </p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal py-1">#</th>
                <th className="text-right font-normal py-1">Distanz</th>
                <th className="text-right font-normal py-1">Zeit</th>
                <th className="text-right font-normal py-1">Pace</th>
                <th className="text-right font-normal py-1">HR</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {run.splits.map((s) => (
                <tr key={s.splitNumber}>
                  <td className="py-1 tabular-nums">{s.splitNumber}</td>
                  <td className="py-1 text-right tabular-nums">
                    {(s.distanceM / 1000).toFixed(2)}km
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {fmtSec(s.durationSec)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {s.paceSecPerKm
                      ? `${Math.floor(s.paceSecPerKm / 60)}:${String(s.paceSecPerKm % 60).padStart(2, "0")}`
                      : "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {s.averageHr ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StrengthExecutedDetail({ strength }: { strength: StrengthExecuted }) {
  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
        Set-Logger
      </p>
      <div className="space-y-3">
        {strength.exercises.map((ex, i) => (
          <div
            key={i}
            className={`rounded-md border p-3 ${ex.skipped ? "opacity-50" : ""}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="font-medium text-sm">{ex.name}</span>
              <span className="text-xs text-muted-foreground">
                Plan: {ex.plannedSets} × {ex.plannedReps}
                {ex.plannedLoadPct != null && ` @ ${ex.plannedLoadPct}%`}
              </span>
            </div>
            {ex.skipped ? (
              <p className="text-xs text-muted-foreground italic">Übersprungen</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-normal py-0.5 w-8">#</th>
                    <th className="text-left font-normal py-0.5">Reps/Dur</th>
                    <th className="text-left font-normal py-0.5">Last</th>
                    <th className="text-left font-normal py-0.5">RPE</th>
                  </tr>
                </thead>
                <tbody>
                  {ex.actualSets.map((s, idx) => (
                    <tr key={idx}>
                      <td className="tabular-nums py-0.5">{idx + 1}</td>
                      <td className="tabular-nums py-0.5">
                        {s.durationSec != null ? `${s.durationSec}s` : `${s.reps} reps`}
                      </td>
                      <td className="tabular-nums py-0.5">
                        {s.loadKg != null ? `${s.loadKg}kg` : "—"}
                      </td>
                      <td className="tabular-nums py-0.5">{s.rpe ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">
        {value}
        {unit}
      </p>
    </div>
  );
}

// ============================================
// Future-day plan
// ============================================
function FuturePlanCard({ sessions }: { sessions: SessionShape[] }) {
  const meaningful = sessions.filter((s) => s.type !== "rest");

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Geplant</h2>
      {meaningful.length === 0 ? (
        <p className="text-muted-foreground">Rest-Tag — keine Session geplant.</p>
      ) : (
        <div className="space-y-4">
          {meaningful.map((s, i) => {
            const exercises = (s.exercises as ExerciseShape[] | undefined) ?? [];
            return (
              <div key={i} className={i > 0 ? "border-t pt-4" : ""}>
                <h3 className="font-semibold text-sm">
                  {SESSION_LABEL[s.type] ?? s.type}
                  {s.durationMin && ` · ${s.durationMin}min`}
                </h3>
                {s.paceTarget && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Pace: {s.paceTarget.from}
                    {s.paceTarget.from !== s.paceTarget.to
                      ? `–${s.paceTarget.to}`
                      : ""}
                    /km{s.intensityZone && ` · Z${s.intensityZone}`}
                  </p>
                )}
                {exercises.length > 0 && <ExerciseList exercises={exercises} />}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground italic">
        Diese Sessions werden am Tag basierend auf deiner Recovery (HRV, Sleep,
        Knee) automatisch angepasst.
      </p>
    </Card>
  );
}
