"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type SensorOutputs = {
  readiness: { score: number; band: string; components: Record<string, number>; trend7d: string };
  load: { acwrRolling: number; band: string; acute7d: number; chronic28d: number; daysOfData: number };
  limitations: { kneeScoreToday: number; therapyPhase: string; constraints: string[]; kneeTrend7d?: string };
};

type ExerciseShape = {
  name: string;
  sets: number;
  reps: number | string;
  loadPct?: number;
  rpeCap?: number;
  tempo?: string;
  restSec?: number;
  notes?: string;
};

type SessionShape = {
  date: string | Date;
  type: string;
  durationMin?: number;
  paceTarget?: { from: string; to: string };
  intensityZone?: number;
  rpeTarget?: number;
  exercises?: ExerciseShape[];
  notes?: string;
};

type FinalSessionShape = SessionShape & {
  wasModified: boolean;
  modifications: string[];
  confidence: number;
  explanation: string;
};

type TodayResponse =
  | { status: "AWAITING_MORNING_INPUT"; plannedSession: SessionShape; plannedSessions?: SessionShape[] }
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

type WeekResponse =
  | { status: "ok"; week: { weekNumber: number; startDate: string; endDate: string; phaseName: string; blockNumber: number; sessions: SessionShape[] } }
  | { status: "NO_ACTIVE_PLAN" | "NO_WEEK_PLAN" };

const SESSION_LABEL: Record<string, string> = {
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

const BAND_COLORS: Record<string, string> = {
  GREEN: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  YELLOW: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 border-yellow-500/30",
  ORANGE: "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-500/30",
  RED: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  OPTIMAL: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  LOW: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  HIGH: "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-500/30",
  DANGER: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  BASELINE_BUILDING: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/30",
};

export default function TodayDashboard() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, w] = await Promise.all([
        fetch("/api/sessions/today").then((r) => r.json() as Promise<TodayResponse>),
        fetch("/api/plan/week?weeksAhead=0").then((r) => r.json() as Promise<WeekResponse>),
      ]);
      setToday(t);
      setWeek(w);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading && !today) return <p className="text-muted-foreground">Lade…</p>;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!today) return null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Heute, {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
          </h1>
          {today.status === "READY" && (
            <>
              <p className="text-sm text-muted-foreground">
                Block {today.week.blockNumber} ({prettyPhase(today.week.phaseName)}) · Woche {today.week.weekNumber}
              </p>
              {!shouldShowKneePill(today.sensorOutputs, today.finalSession.type) && (
                <p className="text-xs text-muted-foreground/80 mt-0.5">
                  Knee {today.sensorOutputs.limitations.kneeScoreToday}/10 · {today.sensorOutputs.limitations.therapyPhase}
                </p>
              )}
            </>
          )}
        </div>
        <NotificationsBell />
      </header>

      <GarminSyncCard onSync={refresh} />

      {today.status === "NO_ACTIVE_PLAN" && (
        <Card>
          <p>Kein aktiver Plan. Bitte Onboarding abschließen.</p>
        </Card>
      )}

      {today.status === "AWAITING_MORNING_INPUT" && (
        <MorningCheckIn onSubmitted={refresh} plannedSession={today.plannedSession} />
      )}

      {today.status === "READY" && (
        <>
          <SensorCards outputs={today.sensorOutputs} todaySessionType={today.finalSession.type} />
          <TodaySessions
            finalSessions={today.finalSessions ?? [today.finalSession]}
            plannedSessions={today.plannedSessions ?? [today.plannedSession]}
          />
          <CoachExplanation finalSession={today.finalSession} />
          <WorkoutActions onChanged={refresh} sessionType={today.finalSession.type} />
        </>
      )}

      {week && week.status === "ok" && <WeekView week={week.week} />}

      <FreeChat />
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-card p-5 shadow-sm ${className}`}>{children}</section>
  );
}

function prettyPhase(phaseName: string): string {
  const map: Record<string, string> = {
    ACCUMULATION_AEROBIC_BASE: "Aerobic Base",
    ACCUMULATION_THRESHOLD_INTRO: "Threshold Intro",
    TRANSMUTATION_THRESHOLD: "Threshold",
    TRANSMUTATION_VO2MAX: "VO2max",
    REALIZATION_PEAK_PERFORMANCE: "Peak Performance",
  };
  return map[phaseName] ?? phaseName;
}

function MorningCheckIn({
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
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">Morning Check-in</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Geplant: {SESSION_LABEL[plannedSession.type] ?? plannedSession.type}
        {plannedSession.durationMin ? ` · ${plannedSession.durationMin}min` : ""}
      </p>
      <div className="grid grid-cols-1 gap-4">
        <Slider label="Subjective Recovery" hint="1=erschöpft, 10=frisch" value={subjectiveRecovery} onChange={setSubj} />
        <Slider label="Morning Stiffness (Knie)" hint="1=keine, 10=starke Steifheit" value={morningStiffness} onChange={setStiff} />
        <Slider label="Stairs Score (Knie beim Treppensteigen)" hint="1=schmerzfrei, 10=starker Schmerz" value={stairsScore} onChange={setStairs} />
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      <Button onClick={submit} disabled={submitting} className="mt-5" size="lg">
        {submitting ? "Speichere…" : "Speichern & Session berechnen"}
      </Button>
    </Card>
  );
}

function Slider({
  label,
  hint,
  value,
  onChange,
  max = 10,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm tabular-nums font-semibold">{value}/{max}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Decide whether the knee pill earns a top-row slot. Otherwise it gets
 * relegated to a subtle one-liner under the header (see kneeSubtleLine).
 */
function shouldShowKneePill(
  outputs: SensorOutputs,
  todaySessionType: string | null,
): boolean {
  const { kneeScoreToday, therapyPhase, constraints, kneeTrend7d } = outputs.limitations;
  if (kneeScoreToday >= 5) return true;
  if (kneeTrend7d === "declining") return true;

  const isStrengthToday = todaySessionType?.startsWith("strength") ?? false;
  if ((therapyPhase === "REACTIVE" || therapyPhase === "DISREPAIR") && isStrengthToday) {
    return true;
  }

  // Constraint actually relevant to today's session?
  const isRunToday = todaySessionType?.includes("run") ?? false;
  for (const c of constraints) {
    if ((c === "no_plyo" || c === "strength_load_cap_70") && isStrengthToday) return true;
    if ((c === "run_intensity_max_M" || c === "no_high_intensity" || c === "no_intervals_under_3min") && isRunToday) return true;
    if (c === "no_threshold_or_higher" && isRunToday) return true;
    if (c === "force_recovery_session") return true;
  }

  return false;
}

function SensorCards({
  outputs,
  todaySessionType,
}: {
  outputs: SensorOutputs;
  todaySessionType: string | null;
}) {
  const showKnee = shouldShowKneePill(outputs, todaySessionType);
  const gridCols = showKnee ? "sm:grid-cols-3" : "sm:grid-cols-2";

  // ACWR pill content varies by band
  const acwr = outputs.load;
  const isColdStart = acwr.band === "BASELINE_BUILDING";
  const acwrPrimary = isColdStart ? "—" : acwr.acwrRolling.toFixed(2);
  const acwrSub = isColdStart ? "BASELINE" : acwr.band;
  const acwrMeta = isColdStart
    ? `Tag ${acwr.daysOfData} von 14`
    : `Acute ${Math.round(acwr.acute7d)} / Chronic ${Math.round(acwr.chronic28d)}`;
  const acwrTooltip = isColdStart
    ? "ACWR braucht 14+ Tage und einen stabilen chronischen Load (>50 AU) für eine valide Auswertung. Vorher wäre die Klassifikation mathematisch trivial."
    : `ACWR rolling=${acwr.acwrRolling.toFixed(2)}, EWMA=${acwr.acute7d > 0 ? Math.round(acwr.chronic28d) : 0} AU baseline`;

  return (
    <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
      <Pill
        title="Readiness"
        primary={`${outputs.readiness.score}/100`}
        sub={outputs.readiness.band}
        band={outputs.readiness.band}
        meta={`Trend 7d: ${outputs.readiness.trend7d}`}
      />
      <Pill
        title="Load (ACWR)"
        primary={acwrPrimary}
        sub={acwrSub}
        band={acwr.band}
        meta={acwrMeta}
        tooltip={acwrTooltip}
      />
      {showKnee && (
        <Pill
          title="Knee"
          primary={`${outputs.limitations.kneeScoreToday}/10`}
          sub={outputs.limitations.therapyPhase}
          band={
            outputs.limitations.kneeScoreToday >= 7
              ? "RED"
              : outputs.limitations.kneeScoreToday >= 5
              ? "ORANGE"
              : outputs.limitations.kneeScoreToday >= 3
              ? "YELLOW"
              : "GREEN"
          }
          meta={
            outputs.limitations.constraints.length > 0
              ? `${outputs.limitations.constraints.length} constraint(s)`
              : "keine Constraints"
          }
        />
      )}
    </div>
  );
}

function Pill({
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

/**
 * Suggested time-of-day slot. Concurrent training rule: lift AFTER endurance
 * to minimise interference (science_doc §5).
 */
function slotLabel(type: string): string {
  if (type.endsWith("_run") || type === "long_run" || type === "vo2max_intervals" || type === "calibration_run" || type === "time_trial_5k") return "AM";
  if (type.startsWith("strength")) return "PM";
  return "";
}

function TodaySessions({
  finalSessions,
  plannedSessions,
}: {
  finalSessions: FinalSessionShape[];
  plannedSessions: SessionShape[];
}) {
  // Filter rest entries when there are also non-rest sessions on the same day
  const meaningful = finalSessions.filter((s) => s.type !== "rest");
  const visible = meaningful.length > 0 ? meaningful : finalSessions;

  if (visible.length === 1) {
    const planned = plannedSessions.find((p) => p.type === visible[0].type) ?? plannedSessions[0];
    return <SessionCard final={visible[0]} planned={planned} />;
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Today&apos;s Sessions</h2>
      <div className="flex flex-col gap-4 divide-y">
        {visible.map((s, i) => {
          const planned = plannedSessions.find((p) => p.type === s.type) ?? plannedSessions[i] ?? plannedSessions[0];
          const slot = slotLabel(s.type);
          return (
            <div key={i} className={i > 0 ? "pt-4" : ""}>
              {slot && (
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                  {slot}
                </div>
              )}
              <SessionBody final={s} planned={planned} variant="inline" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ExerciseList({ exercises }: { exercises: ExerciseShape[] }) {
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
                  Pause {ex.restSec >= 60 ? `${Math.round(ex.restSec / 60)}min` : `${ex.restSec}s`}
                </span>
              )}
              {ex.rpeCap !== undefined && <span>RPE-Cap {ex.rpeCap}</span>}
            </div>
          )}
          {ex.notes && <div className="text-xs italic text-muted-foreground">{ex.notes}</div>}
        </li>
      ))}
    </ul>
  );
}

function SessionBody({
  final,
  planned,
  variant = "inline",
}: {
  final: FinalSessionShape;
  planned: SessionShape;
  variant?: "inline" | "card";
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xl font-bold">{SESSION_LABEL[final.type] ?? final.type}</p>
        {final.wasModified && (
          <span className="rounded-full bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 text-xs font-semibold px-2 py-0.5 border border-yellow-500/30 whitespace-nowrap">
            ↻ modulated
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        {final.durationMin ? `${final.durationMin}min` : "—"}
        {final.paceTarget && ` · Pace ${final.paceTarget.from}${final.paceTarget.from !== final.paceTarget.to ? `–${final.paceTarget.to}` : ""}/km`}
        {final.intensityZone && ` · Z${final.intensityZone}`}
        {final.rpeTarget && ` · RPE ${final.rpeTarget}`}
      </p>
      {final.notes && <p className="text-sm italic text-muted-foreground mt-1">{final.notes}</p>}

      {final.exercises && final.exercises.length > 0 && <ExerciseList exercises={final.exercises} />}

      {final.wasModified && planned.type !== final.type && (
        <div className="mt-3 text-xs text-muted-foreground">
          (Original geplant: {SESSION_LABEL[planned.type] ?? planned.type})
        </div>
      )}
      {/* keep variant prop reachable to silence lint for unused var */}
      <span className="hidden">{variant}</span>
    </>
  );
}

function SessionCard({ final, planned }: { final: FinalSessionShape; planned: SessionShape }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold">Today&apos;s Session</h2>
      </div>
      <div className="mt-3">
        <SessionBody final={final} planned={planned} variant="card" />
      </div>

      {/* Confidence is hidden when ≥70 (Engine sicher genug, kein Signal nötig).
          Bei <70 ein subtiler Hinweis mit Tooltip-Erklärung. */}
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

function WeekView({
  week,
}: {
  week: { weekNumber: number; startDate: string; endDate: string; phaseName: string; blockNumber: number; sessions: SessionShape[] };
}) {
  const todayKey = new Date().toISOString().slice(0, 10);

  // Group sessions by date string YYYY-MM-DD
  const byDate = new Map<string, SessionShape[]>();
  for (const s of week.sessions) {
    const d = (typeof s.date === "string" ? s.date : new Date(s.date as Date).toISOString()).slice(0, 10);
    const arr = byDate.get(d) ?? [];
    arr.push(s);
    byDate.set(d, arr);
  }

  const days: { dateStr: string; label: string; sessions: SessionShape[] }[] = [];
  const start = new Date(week.startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayLabel = d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
    days.push({ dateStr, label: dayLabel, sessions: byDate.get(dateStr) ?? [] });
  }

  return (
    <Card>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Woche {week.weekNumber}</h2>
        <span className="text-xs text-muted-foreground">Block {week.blockNumber} · {prettyPhase(week.phaseName)}</span>
      </header>
      <ul className="divide-y">
        {days.map((d) => {
          const isToday = d.dateStr === todayKey;
          return (
            <li
              key={d.dateStr}
              className={`flex items-start gap-3 py-2 ${isToday ? "bg-accent/40 -mx-2 px-2 rounded" : ""}`}
            >
              <span className={`w-32 text-sm ${isToday ? "font-semibold" : "text-muted-foreground"}`}>
                {d.label} {isToday && "·"}
                {isToday && <span className="ml-1 text-primary">heute</span>}
              </span>
              <div className="flex-1 text-sm">
                {d.sessions.length === 0 || (d.sessions.length === 1 && d.sessions[0].type === "rest") ? (
                  <span className="text-muted-foreground">Rest</span>
                ) : (
                  d.sessions
                    .filter((s) => s.type !== "rest")
                    .map((s, i) => <WeekSessionRow key={i} session={s} />)
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ============================================
// AI Coach Explanation
// ============================================
function CoachExplanation({ finalSession }: { finalSession: FinalSessionShape }) {
  const [aiText, setAiText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fetchExplanation(force = false) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/coach/explain-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (data.status === "AI_COACH_DISABLED") {
        setAiText(null);
        return;
      }
      if (data.status !== "ok") {
        setErr(`AI: ${data.status}`);
        return;
      }
      setAiText(data.explanation);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchExplanation(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Coach</h3>
        <button
          onClick={() => fetchExplanation(true)}
          disabled={loading}
          className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
        >
          {loading ? "…" : "neu"}
        </button>
      </div>

      <p className="mt-2 text-sm leading-relaxed">
        {loading && !aiText && <span className="text-muted-foreground">Coach denkt nach…</span>}
        {err && <span className="text-destructive">{err}</span>}
        {aiText && aiText}
        {!loading && !err && !aiText && <span className="text-muted-foreground italic">{finalSession.explanation}</span>}
      </p>

      {finalSession.modifications.length > 0 && (
        <ul className="mt-3 list-disc pl-4 text-xs text-muted-foreground space-y-1">
          {finalSession.modifications.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ============================================
// Workout Actions: Start / Complete
// ============================================
function WorkoutActions({ onChanged, sessionType }: { onChanged: () => void; sessionType: string }) {
  const [workout, setWorkout] = useState<{ id: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Complete-form state
  const [rpe, setRpe] = useState(7);
  const [duration, setDuration] = useState(45);
  const [trainingScore, setTraining] = useState(3);
  const [notes, setNotes] = useState("");

  // Hydrate today's workout status
  useEffect(() => {
    fetch("/api/workouts?days=1")
      .then((r) => r.json())
      .then((data) => {
        const todayKey = new Date().toISOString().slice(0, 10);
        const w = (data.workouts as { id: string; date: string; status: string }[] | undefined)?.find(
          (w) => w.date.slice(0, 10) === todayKey,
        );
        if (w) setWorkout({ id: w.id, status: w.status });
      })
      .catch(() => {/* ignore */});
  }, []);

  if (sessionType === "rest") {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Heute ist Rest-Tag — keine Session zu starten.</p>
      </Card>
    );
  }

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sessions/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.status ?? `HTTP ${res.status}`);
      setWorkout({ id: data.workoutId, status: "in_progress" });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sessions/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpe, durationActualMin: duration, notes: notes || undefined, trainingScore }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.status ?? `HTTP ${res.status}`);
      setWorkout({ id: data.workoutId, status: "completed" });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to complete");
    } finally {
      setBusy(false);
    }
  }

  if (workout?.status === "completed") {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ Session heute abgeschlossen</p>
      </Card>
    );
  }

  if (!workout || workout.status === "planned") {
    return (
      <Card>
        <Button onClick={start} disabled={busy} size="lg">
          {busy ? "Starte…" : "Session starten"}
        </Button>
        {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      </Card>
    );
  }

  // in_progress → show complete form
  return (
    <Card>
      <h3 className="text-sm font-semibold mb-3">Session abschließen</h3>
      <div className="grid grid-cols-1 gap-4">
        <Slider label="sRPE (gefühlte Anstrengung)" hint="0=ruhig, 10=maximal" value={rpe} onChange={setRpe} max={10} />
        <NumberField label="Tatsächliche Dauer (min)" value={duration} onChange={setDuration} min={1} max={300} />
        <Slider label="Knee Score post-Session" hint="1=schmerzfrei, 10=stark" value={trainingScore} onChange={setTraining} max={10} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Notizen (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="z.B. Wetter, Form, Pace-Range erreicht?"
          />
        </label>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      <Button onClick={complete} disabled={busy} size="lg" className="mt-4">
        {busy ? "Speichere…" : "Abschließen & Load berechnen"}
      </Button>
    </Card>
  );
}

/** A single session row in the week view, collapsible if exercises exist. */
function WeekSessionRow({ session }: { session: SessionShape }) {
  const [open, setOpen] = useState(false);
  const isStrength = session.type.startsWith("strength");
  const hasExercises = isStrength && session.exercises && session.exercises.length > 0;
  const summary = (
    <span>
      {SESSION_LABEL[session.type] ?? session.type}
      {session.durationMin ? ` · ${session.durationMin}min` : ""}
    </span>
  );

  if (!hasExercises) {
    return <div>{summary}</div>;
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-left hover:underline inline-flex items-center gap-1"
      >
        <span className="text-xs text-muted-foreground">{open ? "▼" : "▶"}</span>
        {summary}
      </button>
      {open && session.exercises && (
        <div className="ml-4 mt-1 mb-2">
          <ExerciseList exercises={session.exercises} />
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || 0)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

// ============================================
// Garmin Sync Card
// ============================================
type GarminStatus = {
  lastSync: { syncedAt: string; status: string; hrvSyncOk: boolean; sleepSyncOk: boolean; bodyBatterySyncOk: boolean; rhrSyncOk: boolean; activitiesSyncOk: boolean } | null;
  consecutiveFailures: number;
};

function GarminSyncCard({ onSync }: { onSync: () => void }) {
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const r = await fetch("/api/sensors/garmin-status");
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

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
      if (!r.ok && data.status !== "PARTIAL") throw new Error(data.error ?? data.status ?? `HTTP ${r.status}`);
      await loadStatus();
      onSync();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const lastSyncAt = status?.lastSync?.syncedAt ? new Date(status.lastSync.syncedAt) : null;
  const minutesAgo = lastSyncAt ? Math.round((Date.now() - lastSyncAt.getTime()) / 60000) : null;
  const lastStatus = status?.lastSync?.status;

  let badge: { text: string; classes: string };
  if (!status?.lastSync) badge = { text: "noch nie gesynct", classes: "bg-muted text-muted-foreground" };
  else if (lastStatus === "SUCCESS") badge = { text: "OK", classes: BAND_COLORS.GREEN };
  else if (lastStatus === "PARTIAL") badge = { text: "PARTIAL", classes: BAND_COLORS.YELLOW };
  else badge = { text: "FAIL", classes: BAND_COLORS.RED };

  return (
    <Card className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Garmin Sync</span>
          <span className={`rounded-full text-xs font-semibold px-2 py-0.5 border ${badge.classes}`}>
            {badge.text}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {minutesAgo === null
            ? "Drück Sync, um Garmin-Daten zu laden."
            : minutesAgo < 1
            ? "Gerade gesynct."
            : minutesAgo < 60
            ? `Vor ${minutesAgo} min`
            : `Vor ${Math.round(minutesAgo / 60)}h`}
          {status?.consecutiveFailures && status.consecutiveFailures > 0
            ? ` · ${status.consecutiveFailures}× in Folge fehlgeschlagen`
            : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {err && <span className="text-xs text-destructive">{err}</span>}
        <Button onClick={sync} disabled={busy} size="sm" variant="outline">
          {busy ? "syncing…" : "sync now"}
        </Button>
      </div>
    </Card>
  );
}

// ============================================
// Notifications Bell
// ============================================
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

function NotificationsBell() {
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
        className="relative flex h-9 w-9 items-center justify-center rounded-md border hover:bg-accent"
        aria-label="Notifications"
      >
        <span className="text-base">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-10 w-80 rounded-lg border bg-card shadow-lg">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-muted-foreground hover:underline">
                alle lesen
              </button>
            )}
          </header>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Keine Benachrichtigungen.</p>
            ) : (
              items.map((n) => (
                <NotificationItem key={n.id} n={n} />
              ))
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

// ============================================
// Free-Chat
// ============================================
type ChatMessage = { role: "user" | "assistant"; content: string };

function FreeChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(newMessages);
    setInput("");
    try {
      const r = await fetch("/api/coach/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: trimmed }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setConversationId(data.conversationId);
      setMessages([...newMessages, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setMessages([...newMessages, { role: "assistant", content: `[Fehler: ${e instanceof Error ? e.message : "unknown"}]` }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!open) {
    return (
      <Card>
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between text-left text-sm"
        >
          <span className="font-semibold">Coach-Chat</span>
          <span className="text-muted-foreground">→ Frage stellen</span>
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Coach-Chat</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">
          schließen
        </button>
      </header>
      <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1 mb-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Frag mich z.B. nach deinem HRV-Trend, wie die Engine deine Knee-Score-Logik nutzt, oder warum heute eine Modifikation aktiv war.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm whitespace-pre-line rounded-md p-3 ${
              m.role === "user"
                ? "bg-primary/10 ml-8"
                : "bg-muted/50 mr-8"
            }`}
          >
            {m.content}
          </div>
        ))}
        {busy && <div className="text-xs text-muted-foreground italic">Coach denkt nach…</div>}
      </div>
      <div className="flex flex-col gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Deine Frage… (Enter = Senden, Shift+Enter = neue Zeile)"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled={busy}
        />
        <Button onClick={send} disabled={busy || !input.trim()} size="sm" className="self-end">
          {busy ? "sende…" : "Senden"}
        </Button>
      </div>
    </Card>
  );
}
