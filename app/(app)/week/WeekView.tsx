"use client";

// Sprint v0.11 (Direction C): /week is now a month calendar, not a list.
// File name kept (legacy import in page.tsx). Renamed from "week list" to
// "plan calendar" — Bottom-Nav already labels it "Plan".
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, endOfMonth, startOfMonth, startOfWeek, endOfWeek } from "date-fns";

import {
  PlanCalendar,
  type PlanCalendarDay,
} from "@/components/calendar/PlanCalendar";
import type { SessionPlan } from "@/lib/coach-engine/types";

interface RangeResponse {
  status: "ok";
  days: { date: string; sessions: SessionPlan[] }[];
  blockInfo: {
    blockNumber: number;
    phaseName: string;
    weekNumber: number;
  } | null;
}

export default function WeekView() {
  const router = useRouter();
  const [days, setDays] = useState<PlanCalendarDay[]>([]);
  const [blockInfo, setBlockInfo] = useState<RangeResponse["blockInfo"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRange = useCallback(async (visibleMonth: Date) => {
    // Fetch the full grid window — visible month + leading/trailing weeks —
    // so the calendar's overflow days also light up correctly.
    const start = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/plan/range?start=${format(start, "yyyy-MM-dd")}&end=${format(end, "yyyy-MM-dd")}`,
      );
      const data = (await res.json()) as RangeResponse | { error: string };
      if ("error" in data) {
        setError(data.error);
        setDays([]);
        setBlockInfo(null);
        return;
      }
      setDays(
        data.days.map((d) => ({
          date: new Date(`${d.date}T00:00:00.000Z`),
          sessions: d.sessions,
        })),
      );
      setBlockInfo(data.blockInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRange(new Date());
  }, [loadRange]);

  return (
    <div className="flex flex-col flex-1 min-h-screen pb-20">
      {error && (
        <div className="px-4 py-2 text-xs text-[var(--color-destructive)]">
          {error}
        </div>
      )}
      <PlanCalendar
        days={days}
        blockInfo={blockInfo ?? undefined}
        onMonthChange={loadRange}
        onDayClick={(date) => {
          router.push(`/day/${format(date, "yyyy-MM-dd")}`);
        }}
      />
      {loading && days.length === 0 && (
        <div className="px-4 py-6 text-xs text-[var(--color-foreground-tertiary)] uppercase tracking-wide">
          Lade Plan…
        </div>
      )}
    </div>
  );
}
