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
  isSameDay,
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

function dayLabel(sessions: SessionPlan[]): string {
  if (sessions.length === 0) return "";
  if (sessions.every((s) => s.type === "rest")) return "REST";
  // Show distinct labels, comma-joined; strength sessions collapse to "STR".
  const labels = sessions
    .filter((s) => s.type !== "rest")
    .map((s) => {
      if (s.type.startsWith("strength_")) return "STR";
      return getSessionColor(s.type).label.toUpperCase();
    });
  // Dedupe consecutive strengths (e.g. "EASY · STR · STR" → "EASY · STR")
  const dedup: string[] = [];
  for (const l of labels) {
    if (dedup[dedup.length - 1] !== l) dedup.push(l);
  }
  return dedup.join(" · ");
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
    const entry = days.find((d) => isSameDay(d.date, day));
    return entry?.sessions ?? [];
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {format(firstDayCurrentMonth, "MMMM yyyy", { locale: de })}
          </h2>
          {blockInfo && (
            <p className="text-[var(--color-foreground-tertiary)] text-xs mt-0.5 uppercase tracking-wider">
              Block {blockInfo.blockNumber} · W{blockInfo.weekNumber} ·{" "}
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

              {/* Session label */}
              {label && (
                <span
                  className={cn(
                    "mt-auto text-[9px] font-semibold tracking-wide uppercase leading-tight",
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
