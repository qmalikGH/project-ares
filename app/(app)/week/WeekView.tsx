"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  ExerciseList,
  SESSION_LABEL,
  prettyPhase,
  type SessionShape,
} from "@/components/training/shared";

type WeekResponse =
  | {
      status: "ok";
      week: {
        weekNumber: number;
        startDate: string;
        endDate: string;
        phaseName: string;
        blockNumber: number;
        sessions: SessionShape[];
      };
    }
  | { status: "NO_ACTIVE_PLAN" | "NO_WEEK_PLAN" };

type Span = "1W" | "2W";

export default function WeekView() {
  const router = useRouter();
  const [span, setSpan] = useState<Span>("1W");
  const [weeks, setWeeks] = useState<WeekResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetches: Promise<Response>[] =
        span === "1W"
          ? [fetch("/api/plan/week?weeksAhead=0")]
          : [fetch("/api/plan/week?weeksAhead=0"), fetch("/api/plan/week?weeksAhead=1")];
      const responses = await Promise.all(fetches);
      const data = (await Promise.all(responses.map((r) => r.json()))) as WeekResponse[];
      setWeeks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [span]);

  useEffect(() => {
    load();
  }, [load]);

  const okWeeks = weeks.filter((w): w is Extract<WeekResponse, { status: "ok" }> => w.status === "ok");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wochenansicht</h1>
          <p className="text-sm text-muted-foreground">
            Alle geplanten Sessions. Click auf einen Tag → Detail-Page.
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/30">
          {(["1W", "2W"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSpan(s)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                span === s ? "bg-card font-semibold border" : "text-muted-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {loading && weeks.length === 0 && <p className="text-muted-foreground">Lade…</p>}
      {error && <p className="text-destructive">{error}</p>}

      {okWeeks.length === 0 && !loading && (
        <Card>
          <p className="text-muted-foreground">
            Kein aktiver Wochenplan. Bitte Onboarding abschließen.
          </p>
        </Card>
      )}

      {okWeeks.map((w) => (
        <WeekBlock
          key={w.week.weekNumber}
          week={w.week}
          onDayClick={(date) => router.push(`/day/${date}`)}
        />
      ))}
    </div>
  );
}

function WeekBlock({
  week,
  onDayClick,
}: {
  week: { weekNumber: number; startDate: string; endDate: string; phaseName: string; blockNumber: number; sessions: SessionShape[] };
  onDayClick: (date: string) => void;
}) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const byDate = new Map<string, SessionShape[]>();
  for (const s of week.sessions) {
    const d = (typeof s.date === "string" ? s.date : new Date(s.date).toISOString()).slice(0, 10);
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
    const dayLabel = d.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    days.push({ dateStr, label: dayLabel, sessions: byDate.get(dateStr) ?? [] });
  }

  return (
    <Card>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Woche {week.weekNumber}</h2>
        <span className="text-xs text-muted-foreground">
          Block {week.blockNumber} · {prettyPhase(week.phaseName)}
        </span>
      </header>
      <ul className="divide-y">
        {days.map((d) => {
          const isToday = d.dateStr === todayKey;
          const isPast = d.dateStr < todayKey;
          return (
            <li
              key={d.dateStr}
              className={`flex items-start gap-3 py-2 cursor-pointer hover:bg-accent/30 -mx-2 px-2 rounded ${
                isToday ? "bg-accent/40" : ""
              } ${isPast ? "opacity-70" : ""}`}
              onClick={() => onDayClick(d.dateStr)}
            >
              <span className={`w-32 text-sm ${isToday ? "font-semibold" : "text-muted-foreground"}`}>
                {d.label} {isToday && <span className="ml-1 text-primary">heute</span>}
              </span>
              <div className="flex-1 text-sm">
                {d.sessions.length === 0 ||
                (d.sessions.length === 1 && d.sessions[0].type === "rest") ? (
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
    <div onClick={(e) => e.stopPropagation()}>
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

