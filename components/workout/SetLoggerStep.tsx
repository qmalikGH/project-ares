"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Exercise, StrengthExecutedSession } from "@/lib/coach-engine/types";

interface SetData {
  reps: number;
  loadKg: number | null;
  rpe: number | null;
  durationSec: number | null;
}

interface ExerciseLog {
  name: string;
  plannedSets: number;
  plannedReps: number | string;
  plannedLoadPct: number | null;
  actualSets: SetData[];
  skipped: boolean;
  exerciseNotes?: string;
}

/**
 * Pre-fill set rows from planned exercise.
 * `45sec`-style isometrics → durationSec set, reps=1.
 * Numeric reps → reps pre-filled.
 * Strings like "10/leg" → reps left empty for the user to clarify.
 */
function buildPrefilledSets(ex: Exercise): SetData[] {
  const isIso = typeof ex.reps === "string" && /sec/i.test(ex.reps);
  const numeric = typeof ex.reps === "number" ? ex.reps : 0;
  const isoDur = isIso ? Number.parseInt(String(ex.reps), 10) || 45 : null;

  return Array.from({ length: ex.sets }, () => ({
    reps: isIso ? 1 : numeric,
    loadKg: null,
    rpe: null,
    durationSec: isoDur,
  }));
}

export function SetLoggerStep({
  plannedExercises,
  durationMin,
  onComplete,
}: {
  plannedExercises: Exercise[];
  durationMin: number;
  onComplete: (execution: Pick<StrengthExecutedSession, "exercises" | "durationActualMin">) => void;
}) {
  const [logs, setLogs] = useState<ExerciseLog[]>(() =>
    plannedExercises.map((ex) => ({
      name: ex.name,
      plannedSets: ex.sets,
      plannedReps: ex.reps,
      plannedLoadPct: ex.loadPct ?? null,
      actualSets: buildPrefilledSets(ex),
      skipped: false,
    })),
  );
  const [actualDuration, setActualDuration] = useState(durationMin);

  function updateSet(
    exIdx: number,
    setIdx: number,
    field: keyof SetData,
    value: number | null,
  ) {
    setLogs((prev) => {
      const next = [...prev];
      const exercise = { ...next[exIdx] };
      const sets = [...exercise.actualSets];
      sets[setIdx] = { ...sets[setIdx], [field]: value };
      exercise.actualSets = sets;
      next[exIdx] = exercise;
      return next;
    });
  }

  function toggleSkipped(exIdx: number) {
    setLogs((prev) => {
      const next = [...prev];
      next[exIdx] = { ...next[exIdx], skipped: !next[exIdx].skipped };
      return next;
    });
  }

  function submit() {
    onComplete({
      exercises: logs.map((l) => ({
        name: l.name,
        plannedSets: l.plannedSets,
        plannedReps: l.plannedReps,
        plannedLoadPct: l.plannedLoadPct,
        actualSets: l.skipped ? [] : l.actualSets,
        skipped: l.skipped,
        exerciseNotes: l.exerciseNotes,
      })),
      durationActualMin: actualDuration,
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Trag pro Übung ein, was du tatsächlich gemacht hast. Last in kg, RPE 1-10
        pro Satz.
      </p>

      <div className="space-y-3">
        {logs.map((ex, exIdx) => (
          <ExerciseBlock
            key={exIdx}
            ex={ex}
            exIdx={exIdx}
            onSetUpdate={updateSet}
            onToggleSkipped={() => toggleSkipped(exIdx)}
          />
        ))}
      </div>

      <div className="border-t pt-4 flex items-center gap-3">
        <label className="text-sm font-medium">
          Tatsächliche Gesamtdauer (min):
        </label>
        <input
          type="number"
          value={actualDuration}
          onChange={(e) => setActualDuration(Number.parseInt(e.target.value) || 0)}
          min={1}
          max={300}
          className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
        />
      </div>

      <Button onClick={submit} size="lg">
        Weiter zu RPE & Knee
      </Button>
    </div>
  );
}

function ExerciseBlock({
  ex,
  exIdx,
  onSetUpdate,
  onToggleSkipped,
}: {
  ex: ExerciseLog;
  exIdx: number;
  onSetUpdate: (
    exIdx: number,
    setIdx: number,
    field: keyof SetData,
    value: number | null,
  ) => void;
  onToggleSkipped: () => void;
}) {
  const isIso = typeof ex.plannedReps === "string" && /sec/i.test(ex.plannedReps);

  return (
    <div className={`rounded-md border p-3 ${ex.skipped ? "opacity-50" : ""}`}>
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-sm">{ex.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            Plan: {ex.plannedSets} × {ex.plannedReps}
            {ex.plannedLoadPct != null && ` @ ${ex.plannedLoadPct}%`}
          </span>
        </div>
        <button
          onClick={onToggleSkipped}
          className="text-xs text-muted-foreground hover:underline whitespace-nowrap"
        >
          {ex.skipped ? "doch gemacht" : "übersprungen"}
        </button>
      </div>

      {!ex.skipped && (
        <div className="text-xs">
          <div className={`grid ${isIso ? "grid-cols-[40px_1fr_1fr_1fr]" : "grid-cols-[40px_1fr_1fr_1fr]"} gap-2 text-muted-foreground mb-1`}>
            <span>Satz</span>
            <span>{isIso ? "Dauer (s)" : "Reps"}</span>
            <span>Last (kg)</span>
            <span>RPE</span>
          </div>
          <div className="space-y-1">
            {ex.actualSets.map((s, sIdx) => (
              <div
                key={sIdx}
                className="grid grid-cols-[40px_1fr_1fr_1fr] gap-2 items-center"
              >
                <span className="text-sm tabular-nums">{sIdx + 1}</span>
                {isIso ? (
                  <input
                    type="number"
                    value={s.durationSec ?? ""}
                    onChange={(e) =>
                      onSetUpdate(
                        exIdx,
                        sIdx,
                        "durationSec",
                        e.target.value ? Number.parseInt(e.target.value) : null,
                      )
                    }
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm w-full"
                    min={0}
                  />
                ) : (
                  <input
                    type="number"
                    value={s.reps || ""}
                    onChange={(e) =>
                      onSetUpdate(exIdx, sIdx, "reps", Number.parseInt(e.target.value) || 0)
                    }
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm w-full"
                    min={0}
                  />
                )}
                <input
                  type="number"
                  value={s.loadKg ?? ""}
                  onChange={(e) =>
                    onSetUpdate(
                      exIdx,
                      sIdx,
                      "loadKg",
                      e.target.value ? Number.parseFloat(e.target.value) : null,
                    )
                  }
                  step="2.5"
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm w-full"
                  min={0}
                  placeholder="—"
                />
                <input
                  type="number"
                  value={s.rpe ?? ""}
                  onChange={(e) =>
                    onSetUpdate(
                      exIdx,
                      sIdx,
                      "rpe",
                      e.target.value ? Number.parseInt(e.target.value) : null,
                    )
                  }
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm w-full"
                  min={1}
                  max={10}
                  placeholder="—"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
