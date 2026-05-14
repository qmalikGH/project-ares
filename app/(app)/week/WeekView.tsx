"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, endOfMonth, startOfMonth, startOfWeek, endOfWeek } from "date-fns";

import {
  PlanCalendar,
  type PlanCalendarDay,
} from "@/components/calendar/PlanCalendar";
import { WeekStrip } from "@/components/training/WeekStrip";
import {
  BlockDetail,
  type PhaseSummary,
  type BlockWeekSummary,
} from "@/components/training/BlockDetail";
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

interface ProgressResponse {
  blockStatus?: {
    currentBlockNumber: number;
    currentPhaseName: string;
    weeksTotal: number;
    weekInBlock: number;
    phaseName: string;
    blockStartDate: string;
    blockEndDatePlanned: string;
  };
  phases?: PhaseSummary[];
  blockWeeks?: BlockWeekSummary[];
}

export default function WeekView() {
  const router = useRouter();
  const [days, setDays] = useState<PlanCalendarDay[]>([]);
  const [blockInfo, setBlockInfo] = useState<RangeResponse["blockInfo"]>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRange = useCallback(async (visibleMonth: Date) => {
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

  useEffect(() => {
    fetch("/api/progress")
      .then((r) => r.json())
      .then((d) => setProgress(d))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col flex-1 px-0" style={{ paddingTop: 24, paddingBottom: 100 }}>
      {/* WeekStrip — current week overview */}
      <div className="px-6">
        <WeekStrip />
      </div>

      <div style={{ height: 16 }} />

      {error && (
        <div className="px-6 py-2 text-xs text-[var(--color-destructive)]">
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
        <div className="px-6 py-6 label">Lade Plan…</div>
      )}

      {/* Block Detail — phase tabs + week summaries */}
      {progress?.blockStatus && progress?.blockWeeks && progress?.phases && (
        <BlockDetail
          blockStatus={progress.blockStatus}
          blockWeeks={progress.blockWeeks}
          phases={progress.phases}
        />
      )}
    </div>
  );
}
