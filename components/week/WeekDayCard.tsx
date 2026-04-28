"use client";

// WeekDayCard (Sprint v0.8) — small glass card representing one day in the
// 7-day week grid. Active "today" gets cyan accent + cyan border; past days
// fade. Click navigates to /day/[date].
import Link from "next/link";
import { cn } from "@/lib/utils";

interface WeekDaySession {
  type: string;
  durationMin?: number;
}

interface WeekDayCardProps {
  /** ISO date — used for the /day/[date] link. */
  date: string;
  /** Short weekday label e.g. "Mo", "Di". */
  dayName: string;
  /** Day-of-month, e.g. 28. */
  dayNum: number;
  sessions: WeekDaySession[];
  isToday: boolean;
  isPast: boolean;
}

const SHORT_LABELS: Record<string, string> = {
  easy_run: "Easy",
  threshold_run: "Threshold",
  tempo_run: "Tempo",
  vo2max_intervals: "VO2max",
  long_run: "Long",
  calibration_run: "Calibration",
  time_trial_5k: "5k TT",
  strength_a: "Str A",
  strength_b: "Str B",
  strength_c: "Str C",
  rest: "Rest",
  active_recovery: "Recovery",
  cross_training: "Cross",
  mobility: "Mobility",
};

function shortType(t: string): string {
  return SHORT_LABELS[t] ?? t.replace(/_/g, " ");
}

export function WeekDayCard({
  date,
  dayName,
  dayNum,
  sessions,
  isToday,
  isPast,
}: WeekDayCardProps) {
  const isoDate = date.slice(0, 10);
  const trainingSessions = sessions.filter((s) => s.type !== "rest");
  return (
    <Link
      href={`/day/${isoDate}`}
      className={cn(
        "glass-card flex flex-col p-4 transition-all duration-200",
        "hover:scale-[1.01]",
        isPast && "opacity-40",
        isToday && "border-[var(--accent)] bg-[var(--accent-muted)]",
      )}
      style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
          {dayName}
        </span>
        <span
          className={cn(
            "tabular-nums text-2xl font-semibold",
            isToday ? "text-[var(--accent)]" : "text-[var(--text-primary)]",
          )}
        >
          {dayNum}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
        {trainingSessions.length === 0 ? (
          <span className="italic text-[var(--text-tertiary)]">Rest</span>
        ) : (
          trainingSessions.map((s, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{shortType(s.type)}</span>
              {s.durationMin && (
                <span className="tabular-nums text-[var(--text-tertiary)]">
                  {s.durationMin}m
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </Link>
  );
}
