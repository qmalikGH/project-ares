"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  Pill,
  TodaySessions,
  prettyPhase,
  type FinalSessionShape,
  type SessionShape,
} from "@/components/training/shared";

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

export default function TodayDashboard() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = (await fetch("/api/sessions/today").then((r) => r.json())) as TodayResponse;
      setToday(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading && !today)
    return <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>;
  if (error) return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  if (!today) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Heute,{" "}
          {new Date().toLocaleDateString("de-DE", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h1>
        {today.status === "READY" && (
          <>
            <p className="text-sm text-muted-foreground">
              Block {today.week.blockNumber} ({prettyPhase(today.week.phaseName)}) · Woche{" "}
              {today.week.weekNumber}
            </p>
            {!shouldShowKneePill(today.sensorOutputs, today.finalSession.type) && (
              <p className="text-xs text-muted-foreground/80 mt-0.5">
                Knee {today.sensorOutputs.limitations.kneeScoreToday}/10 ·{" "}
                {today.sensorOutputs.limitations.therapyPhase}
              </p>
            )}
          </>
        )}
      </header>

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
          <SensorCards
            outputs={today.sensorOutputs}
            todaySessionType={today.finalSession.type}
          />
          <TodaySessions
            finalSessions={today.finalSessions ?? [today.finalSession]}
            plannedSessions={today.plannedSessions ?? [today.plannedSession]}
          />
          <CoachExplanation finalSession={today.finalSession} />
          <WorkoutActions onChanged={refresh} sessionType={today.finalSession.type} />
        </>
      )}
    </div>
  );
}

// ============================================
// Knee pill conditional logic
// ============================================
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

  const isRunToday = todaySessionType?.includes("run") ?? false;
  for (const c of constraints) {
    if ((c === "no_plyo" || c === "strength_load_cap_70") && isStrengthToday) return true;
    if (
      (c === "run_intensity_max_M" ||
        c === "no_high_intensity" ||
        c === "no_intervals_under_3min") &&
      isRunToday
    )
      return true;
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

  const acwr = outputs.load;
  const isColdStart = acwr.band === "BASELINE_BUILDING";
  const acwrPrimary = isColdStart ? "—" : acwr.acwrRolling.toFixed(2);
  const acwrSub = isColdStart ? "BASELINE" : acwr.band;
  const acwrMeta = isColdStart
    ? `Tag ${acwr.daysOfData} von 14`
    : `Acute ${Math.round(acwr.acute7d)} / Chronic ${Math.round(acwr.chronic28d)}`;
  const acwrTooltip = isColdStart
    ? "ACWR braucht 14+ Tage und einen stabilen chronischen Load (>50 AU) für eine valide Auswertung. Vorher wäre die Klassifikation mathematisch trivial."
    : `ACWR rolling=${acwr.acwrRolling.toFixed(2)}`;

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

// ============================================
// Morning check-in
// ============================================
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
        Geplant: {plannedSession.type}
        {plannedSession.durationMin ? ` · ${plannedSession.durationMin}min` : ""}
      </p>
      <div className="grid grid-cols-1 gap-4">
        <Slider
          label="Subjective Recovery"
          hint="1=erschöpft, 10=frisch"
          value={subjectiveRecovery}
          onChange={setSubj}
        />
        <Slider
          label="Morning Stiffness (Knie)"
          hint="1=keine, 10=starke Steifheit"
          value={morningStiffness}
          onChange={setStiff}
        />
        <Slider
          label="Stairs Score (Knie beim Treppensteigen)"
          hint="1=schmerzfrei, 10=starker Schmerz"
          value={stairsScore}
          onChange={setStairs}
        />
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
        <span className="text-sm tabular-nums font-semibold">
          {value}/{max}
        </span>
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

// ============================================
// Coach explanation
// ============================================
function CoachExplanation({ finalSession }: { finalSession: FinalSessionShape }) {
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
  }, []);

  useEffect(() => {
    fetchExplanation(false);
  }, [fetchExplanation]);

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
        {!loading && !err && !aiText && (
          <span className="text-muted-foreground italic">{finalSession.explanation}</span>
        )}
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
// Workout actions (start / complete)
// ============================================
function WorkoutActions({
  onChanged,
  sessionType,
}: {
  onChanged: () => void;
  sessionType: string;
}) {
  const [workout, setWorkout] = useState<{ id: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rpe, setRpe] = useState(7);
  const [duration, setDuration] = useState(45);
  const [trainingScore, setTraining] = useState(3);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    fetch("/api/workouts?days=1")
      .then((r) => r.json())
      .then((data) => {
        const todayKey = new Date().toISOString().slice(0, 10);
        const w = (
          data.workouts as { id: string; date: string; status: string }[] | undefined
        )?.find((x) => x.date.slice(0, 10) === todayKey);
        if (w) setWorkout({ id: w.id, status: w.status });
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  if (sessionType === "rest") {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          Heute ist Rest-Tag — keine Session zu starten.
        </p>
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
        body: JSON.stringify({
          rpe,
          durationActualMin: duration,
          notes: notes || undefined,
          trainingScore,
        }),
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
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Session heute abgeschlossen
        </p>
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

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-3">Session abschließen</h3>
      <div className="grid grid-cols-1 gap-4">
        <Slider
          label="sRPE (gefühlte Anstrengung)"
          hint="0=ruhig, 10=maximal"
          value={rpe}
          onChange={setRpe}
          max={10}
        />
        <NumberField
          label="Tatsächliche Dauer (min)"
          value={duration}
          onChange={setDuration}
          min={1}
          max={300}
        />
        <Slider
          label="Knee Score post-Session"
          hint="1=schmerzfrei, 10=stark"
          value={trainingScore}
          onChange={setTraining}
          max={10}
        />
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
