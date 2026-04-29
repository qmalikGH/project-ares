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
  // Sprint v0.7: superset metadata, propagated from planned Exercise.
  supersetGroup?: string | null;
  supersetOrder?: number | null;
  supersetRationale?: string;
  restSec?: number;
}

/**
 * Pre-fill set rows from planned exercise.
 *
 * - `45sec`-style isometrics → durationSec set, reps=1.
 * - Numeric reps → reps pre-filled.
 * - Strings like "10/leg" → reps left empty for the user to clarify.
 * - Sprint v0.11: when the engine pre-computed an absolute load (`loadAbs`)
 *   from the user's 1RM × loadPct, seed loadKg with it so Q only edits when
 *   reality diverges. Without `loadAbs` (no 1RM yet) loadKg stays null.
 */
function buildPrefilledSets(ex: Exercise): SetData[] {
  const isIso = typeof ex.reps === "string" && /sec/i.test(ex.reps);
  const numeric = typeof ex.reps === "number" ? ex.reps : 0;
  const isoDur = isIso ? Number.parseInt(String(ex.reps), 10) || 45 : null;
  const seededLoad =
    typeof ex.loadAbs === "number" && ex.loadAbs > 0 ? ex.loadAbs : null;

  return Array.from({ length: ex.sets }, () => ({
    reps: isIso ? 1 : numeric,
    loadKg: seededLoad,
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
      supersetGroup: ex.supersetGroup ?? null,
      supersetOrder: ex.supersetOrder ?? null,
      supersetRationale: ex.supersetRationale,
      restSec: ex.restSec,
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
        {groupBySuperset(logs).map((group, gIdx) =>
          group.kind === "single" ? (
            <ExerciseBlock
              key={`s-${gIdx}`}
              ex={group.item.log}
              exIdx={group.item.idx}
              onSetUpdate={updateSet}
              onToggleSkipped={() => toggleSkipped(group.item.idx)}
            />
          ) : (
            <SupersetBlock
              key={`g-${gIdx}-${group.groupId}`}
              groupId={group.groupId}
              rationale={group.rationale}
              restSec={group.restSec}
              items={group.items}
              onSetUpdate={updateSet}
              onToggleSkipped={toggleSkipped}
            />
          ),
        )}
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

// ============================================
// Superset grouping (Sprint v0.7)
// ============================================

type GroupedItem =
  | { kind: "single"; item: { log: ExerciseLog; idx: number } }
  | {
      kind: "superset";
      groupId: string;
      rationale: string | undefined;
      restSec: number | undefined; // pause after the pair (from order=2 entry)
      items: { log: ExerciseLog; idx: number }[];
    };

/**
 * Walk the exercise list keeping order intact. Consecutive exercises sharing
 * the same supersetGroup are bundled into a `superset` group; everything else
 * stays a `single`. Pause-after-pair = restSec of the highest-order member.
 */
function groupBySuperset(logs: ExerciseLog[]): GroupedItem[] {
  const out: GroupedItem[] = [];
  let i = 0;
  while (i < logs.length) {
    const current = logs[i];
    const groupId = current.supersetGroup ?? null;
    if (!groupId) {
      out.push({ kind: "single", item: { log: current, idx: i } });
      i += 1;
      continue;
    }
    // Collect run of contiguous logs sharing groupId.
    const items: { log: ExerciseLog; idx: number }[] = [];
    while (i < logs.length && logs[i].supersetGroup === groupId) {
      items.push({ log: logs[i], idx: i });
      i += 1;
    }
    const last = items[items.length - 1];
    out.push({
      kind: "superset",
      groupId,
      rationale: items.find((x) => x.log.supersetRationale)?.log.supersetRationale,
      restSec: last.log.restSec,
      items,
    });
  }
  return out;
}

function SupersetBlock({
  groupId,
  rationale,
  restSec,
  items,
  onSetUpdate,
  onToggleSkipped,
}: {
  groupId: string;
  rationale?: string;
  restSec?: number;
  items: { log: ExerciseLog; idx: number }[];
  onSetUpdate: (
    exIdx: number,
    setIdx: number,
    field: keyof SetData,
    value: number | null,
  ) => void;
  onToggleSkipped: (exIdx: number) => void;
}) {
  return (
    <div className="rounded-md border-l-4 border-blue-500 bg-blue-500/5 p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            Superset {groupId}
          </span>
          {rationale && (
            <p className="mt-1 text-[11px] text-muted-foreground" title={rationale}>
              {rationale}
            </p>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground italic">
          0–15s zwischen A→B · {restSec ?? "?"}s nach Paar
        </p>
      </div>
      {items.map(({ log, idx }, i) => (
        <div key={idx} className="relative">
          {i < items.length - 1 && (
            <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-blue-500">
              ↓
            </div>
          )}
          <ExerciseBlock
            ex={log}
            exIdx={idx}
            onSetUpdate={onSetUpdate}
            onToggleSkipped={() => onToggleSkipped(idx)}
            inSuperset
          />
        </div>
      ))}
    </div>
  );
}

function ExerciseBlock({
  ex,
  exIdx,
  onSetUpdate,
  onToggleSkipped,
  inSuperset,
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
  inSuperset?: boolean;
}) {
  const isIso = typeof ex.plannedReps === "string" && /sec/i.test(ex.plannedReps);
  const wrapperCls = inSuperset
    ? `rounded-md bg-background/60 p-2 ${ex.skipped ? "opacity-50" : ""}`
    : `rounded-md border p-3 ${ex.skipped ? "opacity-50" : ""}`;

  return (
    <div className={wrapperCls}>
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
