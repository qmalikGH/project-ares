"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  ExerciseList,
  SESSION_LABEL,
  type ExerciseShape,
  type SessionShape,
} from "@/components/training/shared";
import { StatsSubNav } from "@/components/layout/StatsSubNav";
import { getSessionColor } from "@/lib/ui/session-colors";

type WorkoutItem = {
  id: string;
  date: string;
  type: string;
  status: string;
  modulationApplied: boolean;
  modulations: string[] | null;
  modulationReason: string | null;
  rpe: number | null;
  durationActualMin: number | null;
  notes: string | null;
  plannedSession: SessionShape;
  executedSession: unknown;
  garminActivityId: string | null;
  sensorMorning: { stiffness: number | null; stairs: number | null } | null;
};

type HistoryResponse = {
  status: string;
  workouts: WorkoutItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  quickStats: {
    thisWeekSessions: number;
    thisWeekRunMin: number;
    thisWeekStrengthCount: number;
  };
};

type TypeFilter = "all" | "run" | "strength";
type StatusFilter = "all" | "completed" | "modified" | "skipped";

export default function HistoryView() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        type: typeFilter,
        status: statusFilter,
      });
      const r = await fetch(`/api/history?${params.toString()}`);
      const d = (await r.json()) as HistoryResponse;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [page, typeFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  if (!data)
    return <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <StatsSubNav />
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Historie</h1>
        <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[var(--color-foreground-muted)]" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
          <span className="num">{data.quickStats.thisWeekSessions}</span> Sessions · <span className="num">{data.quickStats.thisWeekRunMin}</span> min Lauf diese Woche
        </p>
      </header>

      <QuickStats stats={data.quickStats} />

      <FilterBar
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        onTypeChange={(t) => {
          setTypeFilter(t);
          setPage(1);
        }}
        onStatusChange={(s) => {
          setStatusFilter(s);
          setPage(1);
        }}
      />

      {data.workouts.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">
            Keine Workouts gefunden.
            {(typeFilter !== "all" || statusFilter !== "all") && (
              <button
                onClick={() => {
                  setTypeFilter("all");
                  setStatusFilter("all");
                  setPage(1);
                }}
                className="ml-2 text-primary hover:underline"
              >
                Filter zurücksetzen
              </button>
            )}
          </p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y">
            {data.workouts.map((w) => (
              <WorkoutRow
                key={w.id}
                workout={w}
                expanded={expandedId === w.id}
                onToggle={() =>
                  setExpandedId((id) => (id === w.id ? null : w.id))
                }
              />
            ))}
          </ul>
        </Card>
      )}

      {data.pagination.totalPages > 1 && (
        <Pagination
          page={data.pagination.page}
          totalPages={data.pagination.totalPages}
          onChange={(p) => {
            setPage(p);
            setExpandedId(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================
// Quick stats
// ============================================
function QuickStats({
  stats,
}: {
  stats: HistoryResponse["quickStats"];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: "SESSIONS", value: String(stats.thisWeekSessions), unit: "" },
        { label: "LAUF", value: String(stats.thisWeekRunMin), unit: "min" },
        { label: "STRENGTH", value: String(stats.thisWeekStrengthCount), unit: "" },
      ].map((s) => (
        <div
          key={s.label}
          className="flex flex-col gap-1 py-3 pl-3"
          style={{ borderLeft: "2px solid var(--color-rule)" }}
        >
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-foreground-muted)]" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
            {s.label}
          </span>
          <div className="flex items-baseline gap-1">
            <span className="num" style={{ fontSize: 22 }}>{s.value}</span>
            {s.unit && <span className="text-[11px] text-[var(--color-foreground-muted)]">{s.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Filter bar
// ============================================
function FilterBar({
  typeFilter,
  statusFilter,
  onTypeChange,
  onStatusChange,
}: {
  typeFilter: TypeFilter;
  statusFilter: StatusFilter;
  onTypeChange: (t: TypeFilter) => void;
  onStatusChange: (s: StatusFilter) => void;
}) {
  const typeOptions: { v: TypeFilter; label: string }[] = [
    { v: "all", label: "Alle" },
    { v: "run", label: "Lauf" },
    { v: "strength", label: "Strength" },
  ];
  const statusOptions: { v: StatusFilter; label: string }[] = [
    { v: "all", label: "Alle" },
    { v: "completed", label: "Completed" },
    { v: "modified", label: "Modified" },
    { v: "skipped", label: "Skipped" },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Typ</p>
        <div className="inline-flex rounded-md border">
          {typeOptions.map((o) => (
            <button
              key={o.v}
              onClick={() => onTypeChange(o.v)}
              className={`px-3 py-1 text-sm transition-colors ${
                typeFilter === o.v
                  ? "bg-card font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-1">Status</p>
        <div className="inline-flex rounded-md border">
          {statusOptions.map((o) => (
            <button
              key={o.v}
              onClick={() => onStatusChange(o.v)}
              className={`px-3 py-1 text-sm transition-colors ${
                statusFilter === o.v
                  ? "bg-card font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Workout row
// ============================================
function WorkoutRow({
  workout,
  expanded,
  onToggle,
}: {
  workout: WorkoutItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const date = new Date(workout.date);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - date.getTime()) / 86400000);
  const relative =
    days === 0 ? "heute" : days === 1 ? "gestern" : `vor ${days} Tagen`;

  const statusIcon =
    workout.status === "completed" && !workout.modulationApplied
      ? "✓"
      : workout.status === "completed" && workout.modulationApplied
      ? "↻"
      : workout.status === "skipped" || workout.status === "skipped_illness"
      ? "✗"
      : "⚪";

  const statusColor =
    workout.status === "completed" && !workout.modulationApplied
      ? "text-emerald-600 dark:text-emerald-400"
      : workout.status === "completed"
      ? "text-yellow-700 dark:text-yellow-300"
      : workout.status === "skipped" || workout.status === "skipped_illness"
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";

  const sessionColor = getSessionColor(workout.type);

  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full text-left flex items-start gap-3 py-4 px-1 hover:bg-accent/30 -mx-1 rounded transition-colors"
        style={{ borderLeft: `3px solid ${sessionColor.color}`, paddingLeft: 12 }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: sessionColor.color, fontFamily: "var(--font-geist-mono), monospace" }}>
              {SESSION_LABEL[workout.type] ?? workout.type}
            </span>
            <span className="text-[9px] text-[var(--color-foreground-muted)] uppercase tracking-[0.08em]" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
              {date.toLocaleDateString("de-DE", { day: "numeric", month: "short" })} · {relative}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-medium">
                {SESSION_LABEL[workout.type] ?? workout.type}
              </div>
              <div className="text-[11px] text-[var(--color-foreground-muted)] mt-1" style={{ fontFamily: "var(--font-geist-mono), monospace", letterSpacing: "0.04em" }}>
                {workout.durationActualMin != null && <>{workout.durationActualMin}min</>}
                {workout.rpe != null && <> · RPE {workout.rpe}</>}
                {workout.modulationApplied &&
                  workout.modulations &&
                  workout.modulations.length > 0 && (
                    <span className="text-[var(--color-warning)]">
                      {" "}· ↻ {workout.modulations.length} Mod.
                    </span>
                  )}
              </div>
            </div>
            {workout.rpe != null && (
              <div className="text-right flex-shrink-0">
                <div className="text-[9px] text-[var(--color-foreground-muted)] uppercase tracking-[0.18em]" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                  RPE <span className="num" style={{ color: workout.rpe >= 8 ? "var(--color-destructive)" : workout.rpe >= 6 ? "var(--color-warning)" : "var(--color-success)" }}>{workout.rpe}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </button>

      {expanded && <WorkoutDetail workout={workout} />}
    </li>
  );
}

// ============================================
// Workout detail (expanded)
// ============================================
function WorkoutDetail({ workout }: { workout: WorkoutItem }) {
  const planned = workout.plannedSession;
  const exercises = (planned.exercises as ExerciseShape[] | undefined) ?? [];

  return (
    <div className="ml-9 mb-3 px-3 py-3 rounded-md bg-muted/30 text-sm space-y-3">
      {/* Plan summary */}
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
          Geplant
        </p>
        <p>
          {SESSION_LABEL[planned.type] ?? planned.type}
          {planned.durationMin && ` · ${planned.durationMin}min`}
          {planned.paceTarget && ` · Pace ${planned.paceTarget.from}–${planned.paceTarget.to}/km`}
          {planned.intensityZone && ` · Z${planned.intensityZone}`}
          {planned.rpeTarget != null && ` · RPE ${planned.rpeTarget}`}
        </p>
      </div>

      {exercises.length > 0 && <ExerciseList exercises={exercises} />}

      {/* Modulationen */}
      {workout.modulationApplied &&
        workout.modulations &&
        workout.modulations.length > 0 && (
          <div>
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

      {/* Pre-session knee + RPE */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {workout.sensorMorning && (
          <>
            <div>
              <p className="text-muted-foreground">Morning Stiffness</p>
              <p className="font-semibold tabular-nums">
                {workout.sensorMorning.stiffness ?? "—"}
                {workout.sensorMorning.stiffness != null && "/10"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Stairs</p>
              <p className="font-semibold tabular-nums">
                {workout.sensorMorning.stairs ?? "—"}
                {workout.sensorMorning.stairs != null && "/10"}
              </p>
            </div>
          </>
        )}
        <div>
          <p className="text-muted-foreground">sRPE</p>
          <p className="font-semibold tabular-nums">
            {workout.rpe ?? "—"}
            {workout.rpe != null && "/10"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Dauer</p>
          <p className="font-semibold tabular-nums">
            {workout.durationActualMin ? `${workout.durationActualMin}min` : "—"}
          </p>
        </div>
      </div>

      {/* Notes */}
      {workout.notes && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Notizen
          </p>
          <p className="italic text-xs">{workout.notes}</p>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Link
          href={`/day/${new Date(workout.date).toISOString().slice(0, 10)}`}
          className="text-xs text-primary hover:underline"
        >
          → Tag-Detail öffnen
        </Link>
        {workout.garminActivityId && (
          <a
            href={`https://connect.garmin.com/modern/activity/${workout.garminActivityId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            → in Garmin Connect öffnen
          </a>
        )}
      </div>
    </div>
  );
}

// ============================================
// Pagination
// ============================================
function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
      >
        ← zurück
      </button>
      <span className="text-sm text-muted-foreground tabular-nums">
        Seite {page} von {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
      >
        weiter →
      </button>
    </div>
  );
}
