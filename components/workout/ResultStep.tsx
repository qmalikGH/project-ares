"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { StrengthExecutedSession } from "@/lib/coach-engine/types";

export interface CompletePayload {
  rpe: number;
  trainingScore: number;
  durationActualMin?: number;
  notes?: string;
  garminActivityId?: number;
  strengthExecution?: StrengthExecutedSession;
}

export function ResultStep({
  workoutId,
  garminActivityId,
  strengthExecution,
  isStrength,
  defaultDurationMin,
  onSubmitted,
}: {
  /** Sprint v0.11+: which Workout to mark complete. Required so two-a-days
   * (Easy Run + Strength A on the same day) finish independently. */
  workoutId: string;
  garminActivityId: number | null;
  strengthExecution: Pick<StrengthExecutedSession, "exercises" | "durationActualMin"> | null;
  isStrength: boolean;
  defaultDurationMin: number;
  onSubmitted: () => void;
}) {
  const [rpe, setRpe] = useState(7);
  const [trainingScore, setTraining] = useState(3);
  // Sprint v0.10: knee-pain NRS during strength sessions. Drives the HSR
  // pain-override in the next week's periodization.
  const [kneePainNrs, setKneePainNrs] = useState(0);
  const [duration, setDuration] = useState(
    strengthExecution?.durationActualMin ?? defaultDurationMin,
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      // Build payload
      const payload: Record<string, unknown> = {
        rpe,
        trainingScore,
        notes: notes || undefined,
        workoutId, // pin completion to THIS Workout row (two-a-day fix)
      };
      if (garminActivityId) {
        payload.garminActivityId = garminActivityId;
      } else if (strengthExecution) {
        payload.strengthExecution = {
          type: "strength",
          source: "manual",
          garminActivityId: null,
          startTimeLocal: new Date().toISOString(),
          durationActualMin: strengthExecution.durationActualMin,
          averageHr: null,
          maxHr: null,
          calories: null,
          exercises: strengthExecution.exercises,
          // Sprint v0.10: pass knee-pain NRS into the strength payload so
          // the next week's periodization can read prevPainNrs.
          kneePainNrs,
        };
      } else {
        payload.durationActualMin = duration;
      }

      const res = await fetch("/api/sessions/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.status ?? `HTTP ${res.status}`);
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {garminActivityId
          ? "Garmin-Daten werden automatisch importiert (Pace, HR, Splits). Trag noch sRPE und Knee ein."
          : strengthExecution
          ? "Strength-Logger gespeichert. Trag noch sRPE und Knee ein."
          : "Manuelle Erfassung — trag Dauer, sRPE und Knee ein."}
      </p>

      <div className="grid grid-cols-1 gap-4">
        <SliderRow
          label="sRPE (gefühlte Anstrengung)"
          hint="0=ruhig, 10=maximal"
          value={rpe}
          onChange={setRpe}
        />
        {!garminActivityId && !strengthExecution && (
          <NumberRow
            label="Tatsächliche Dauer (min)"
            value={duration}
            onChange={setDuration}
            min={1}
            max={300}
          />
        )}
        <SliderRow
          label="Knee Score post-Session"
          hint="1=schmerzfrei, 10=stark"
          value={trainingScore}
          onChange={setTraining}
        />
        {isStrength && (
          <SliderRow
            label="Knieschmerz während der Session (NRS)"
            hint="0=keine, ≤3 progress, 4-5 hold, >5 step back (Sprint v0.10 HSR-Periodization)"
            value={kneePainNrs}
            onChange={setKneePainNrs}
          />
        )}
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

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Button onClick={submit} disabled={busy} size="lg">
        {busy ? "Speichere…" : "Abschließen"}
      </Button>
    </div>
  );
}

function SliderRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm tabular-nums font-semibold">{value}/10</span>
      </div>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function NumberRow({
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
