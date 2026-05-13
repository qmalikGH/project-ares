"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { startOfWeek, addDays, format, isToday } from "date-fns";
import { de } from "date-fns/locale";
import { getSessionColor } from "@/lib/ui/session-colors";

type DaySession = { type: string };
type WeekDay = { date: Date; sessions: DaySession[] };

const DAY_ABBR = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];

function pickPrimaryType(sessions: DaySession[]): string | null {
  if (sessions.length === 0) return null;
  const priority: Record<string, number> = {
    time_trial_5k: 0, vo2max_intervals: 1, threshold_run: 2, tempo_run: 2,
    long_run: 3, calibration_run: 4, easy_run: 5, active_recovery: 6,
    strength_a: 7, strength_b: 7, strength_c: 7, rest: 99,
  };
  const sorted = [...sessions].sort(
    (a, b) => (priority[a.type] ?? 50) - (priority[b.type] ?? 50),
  );
  return sorted[0].type;
}

export function WeekStrip() {
  const [days, setDays] = useState<WeekDay[]>([]);

  useEffect(() => {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const sunday = addDays(monday, 6);
    const start = format(monday, "yyyy-MM-dd");
    const end = format(sunday, "yyyy-MM-dd");

    fetch(`/api/plan/range?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error || !data.days) return;
        const weekDays: WeekDay[] = [];
        for (let i = 0; i < 7; i++) {
          const d = addDays(monday, i);
          const key = format(d, "yyyy-MM-dd");
          const entry = (data.days as { date: string; sessions: DaySession[] }[])
            .find((dd) => dd.date === key);
          weekDays.push({ date: d, sessions: entry?.sessions ?? [] });
        }
        setDays(weekDays);
      })
      .catch(() => {});
  }, []);

  if (days.length === 0) return null;

  return (
    <div>
      <div className="section-h">
        <span className="label">Diese Woche</span>
        <Link href="/week" className="more">Plan →</Link>
      </div>
      <div style={{ height: 10 }} />
      <div className="weekstrip">
        {days.map((day, i) => {
          const today = isToday(day.date);
          const primaryType = pickPrimaryType(day.sessions);
          const isRest = primaryType === "rest" || primaryType === "active_recovery";
          const color = primaryType ? getSessionColor(primaryType) : null;

          return (
            <div
              key={i}
              className={`d${today ? " is-today" : ""}${isRest ? " is-rest" : ""}`}
            >
              <div className="dn">{DAY_ABBR[i]}</div>
              <div className="dnum">{format(day.date, "d")}</div>
              <div
                className="tick"
                style={
                  color && !isRest
                    ? ({ "--tk": color.color } as React.CSSProperties)
                    : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
