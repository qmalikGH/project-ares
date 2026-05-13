"use client";

// Direction C calendar (Sprint v0.11). Adapted from shadcn FullScreenCalendar:
// kept date-fns logic + month-nav + selectedDay state; replaced visuals with
// session-type-colored cells + Mono-text labels + amber today-marker.
//
// Week starts Monday (ISO 8601 / European convention) — date-fns
// `weekStartsOn: 1`. Weekday header is `Mo Di Mi Do Fr Sa So`.
import * as React from "react";
import {
  add,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parse,
  startOfToday,
  startOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { getSessionColor } from "@/lib/ui/session-colors";
import type { SessionPlan } from "@/lib/coach-engine/types";

export interface PlanCalendarDay {
  date: Date;
  sessions: SessionPlan[];
}

interface PlanCalendarProps {
  days: PlanCalendarDay[];
  blockInfo?: {
    blockNumber: number;
    weekNumber: number;
    phaseName: string;
  } | null;
  /** Called when the user taps a day cell. */
  onDayClick: (date: Date) => void;
  /** Called when the visible month changes — parent should refetch. */
  onMonthChange?: (visibleMonth: Date) => void;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** Pick the most "important" session for color/label priority. */
function pickPrimarySession(sessions: SessionPlan[]): SessionPlan | null {
  if (sessions.length === 0) return null;
  const priority: Record<string, number> = {
    time_trial_5k: 0,
    vo2max_intervals: 1,
    threshold_run: 2,
    tempo_run: 2,
    long_run: 3,
    calibration_run: 4,
    easy_run: 5,
    active_recovery: 6,
    strength_a: 7,
    strength_b: 7,
    strength_c: 7,
    rest: 99,
  };
  return [...sessions].sort(
    (a, b) => (priority[a.type] ?? 50) - (priority[b.type] ?? 50),
  )[0];
}

/** Compact 2–4 char abbreviation per session type — picked so the label
 *  fits in a ~50px-wide iPhone 11 calendar cell at 9px font. Two-a-day
 *  combinations also stay under ~10 chars when joined by '+'. */
function shortAbbr(type: string): string {
  if (type.startsWith("strength_")) return "STR";
  switch (type) {
    case "easy_run":
      return "EASY";
    case "threshold_run":
      return "THR";
    case "tempo_run":
      return "TEM";
    case "long_run":
      return "LONG";
    case "vo2max_intervals":
      return "VO2";
    case "calibration_run":
      return "CAL";
    case "time_trial_5k":
      return "TT";
    case "active_recovery":
      return "REC";
    case "rest":
      return "REST";
    default:
      return type.slice(0, 4).toUpperCase();
  }
}

function dayLabel(sessions: SessionPlan[]): string {
  if (sessions.length === 0) return "";
  if (sessions.every((s) => s.type === "rest")) return "REST";
  const seen: string[] = [];
  for (const s of sessions) {
    if (s.type === "rest") continue;
    const abbr = shortAbbr(s.type);
    if (seen[seen.length - 1] !== abbr && !seen.includes(abbr)) {
      seen.push(abbr);
    }
  }
  // Use '+' on mobile (cheaper than ' · ' which adds two extra characters
  // including a wide middot), keeps "EASY+STR" under 9 chars.
  return seen.join("+");
}

export function PlanCalendar({
  days,
  blockInfo,
  onDayClick,
  onMonthChange,
}: PlanCalendarProps) {
  const today = startOfToday();
  const [currentMonth, setCurrentMonth] = React.useState(
    format(today, "MMM-yyyy"),
  );
  const firstDayCurrentMonth = parse(currentMonth, "MMM-yyyy", new Date());

  // Grid covers full weeks: from Monday of first week to Sunday of last.
  const gridDays = eachDayOfInterval({
    start: startOfWeek(firstDayCurrentMonth, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(firstDayCurrentMonth), { weekStartsOn: 1 }),
  });

  // Notify parent when month changes so it can refetch sessions.
  React.useEffect(() => {
    onMonthChange?.(firstDayCurrentMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth]);

  const previousMonth = () =>
    setCurrentMonth(
      format(add(firstDayCurrentMonth, { months: -1 }), "MMM-yyyy"),
    );
  const nextMonth = () =>
    setCurrentMonth(
      format(add(firstDayCurrentMonth, { months: 1 }), "MMM-yyyy"),
    );
  const goToToday = () => setCurrentMonth(format(today, "MMM-yyyy"));

  function getSessionsForDay(day: Date): SessionPlan[] {
    // Session dates are UTC-midnight (the date IS the intended calendar day);
    // grid days are local-midnight. Match by their respective YYYY-MM-DD so
    // the lookup stays correct in any browser timezone (esp. when traveling).
    const dayKey = format(day, "yyyy-MM-dd");
    const entry = days.find(
      (d) => d.date.toISOString().slice(0, 10) === dayKey,
    );
    return entry?.sessions ?? [];
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Header — appbar style */}
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {format(firstDayCurrentMonth, "MMMM yyyy", { locale: de })}
          </h2>
          {blockInfo && (
            <p className="text-[var(--color-foreground-muted)] text-[10px] mt-0.5 uppercase tracking-[0.14em] font-semibold" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
              Block <span className="num">{blockInfo.blockNumber}</span> · W<span className="num">{blockInfo.weekNumber}</span> ·{" "}
              {blockInfo.phaseName.replace(/_/g, " ").toLowerCase()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={previousMonth}
            aria-label="Vorheriger Monat"
            className="p-2 text-[var(--color-foreground-tertiary)] hover:text-[var(--color-foreground)] transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={goToToday}
            className="px-3 py-1 text-xs font-medium text-[var(--color-foreground-secondary)] hover:text-[var(--color-foreground)] uppercase tracking-wide transition-colors"
          >
            Heute
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Nächster Monat"
            className="p-2 text-[var(--color-foreground-tertiary)] hover:text-[var(--color-foreground)] transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <hr className="rule" />

      {/* Weekday header */}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-[10px] font-medium text-[var(--color-foreground-muted)] uppercase tracking-widest"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 flex-1 border-t border-[var(--color-rule)]">
        {gridDays.map((day, idx) => {
          const sessionsForDay = getSessionsForDay(day);
          const primary = pickPrimarySession(sessionsForDay);
          const label = dayLabel(sessionsForDay);
          const inMonth = isSameMonth(day, firstDayCurrentMonth);
          const isCurrentDay = isToday(day);
          const isRestDay =
            sessionsForDay.length > 0 &&
            sessionsForDay.every((s) => s.type === "rest");

          const cellTint =
            primary && primary.type !== "rest"
              ? getSessionColor(primary.type).color
              : null;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onDayClick(day)}
              className={cn(
                "relative flex flex-col items-start p-2 min-h-[72px] border-b border-r border-[var(--color-rule)] transition-colors text-left",
                !inMonth && "opacity-30",
                inMonth && "hover:bg-[var(--color-surface)]",
              )}
              style={
                cellTint
                  ? {
                      backgroundColor: `color-mix(in srgb, ${cellTint} 6%, transparent)`,
                    }
                  : undefined
              }
            >
              {/* Today marker: thin amber bar at top */}
              {isCurrentDay && (
                <span className="absolute top-0 left-2 right-2 h-[2px] bg-[var(--color-session-threshold)]" />
              )}

              {/* Day number (Mono) */}
              <span
                className={cn(
                  "num text-xs",
                  isCurrentDay &&
                    "text-[var(--color-session-threshold)] font-bold",
                  !isCurrentDay &&
                    inMonth &&
                    "text-[var(--color-foreground-secondary)]",
                  !inMonth && "text-[var(--color-foreground-muted)]",
                )}
              >
                {format(day, "d")}
              </span>

              {/* Session label — `truncate` is the safety net so any future
                  long abbreviation can't visually bleed into the next cell. */}
              {label && (
                <span
                  className={cn(
                    "mt-auto block w-full max-w-full truncate text-[9px] font-semibold uppercase leading-tight",
                  )}
                  style={
                    isRestDay
                      ? { color: "var(--color-foreground-muted)" }
                      : cellTint
                        ? { color: cellTint }
                        : undefined
                  }
                >
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
