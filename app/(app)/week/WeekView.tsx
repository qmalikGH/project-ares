"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, endOfMonth, startOfMonth, startOfWeek, endOfWeek } from "date-fns";

import {
  PlanCalendar,
  type PlanCalendarDay,
} from "@/components/calendar/PlanCalendar";
import { WeekStrip } from "@/components/training/WeekStrip";
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
    weeksTotal: number;
    weekInBlock: number;
    phaseName: string;
  };
}

function BlockVerlauf({ blockInfo, progress }: {
  blockInfo: { blockNumber: number; weekNumber: number; phaseName: string } | null;
  progress: ProgressResponse | null;
}) {
  const weeksTotal = progress?.blockStatus?.weeksTotal ?? 4;
  const currentWeek = blockInfo?.weekNumber ?? progress?.blockStatus?.weekInBlock ?? 1;

  if (!blockInfo && !progress?.blockStatus) return null;

  return (
    <div className="px-6" style={{ paddingTop: 20, paddingBottom: 20 }}>
      <div className="section-h" style={{ padding: 0 }}>
        <span className="label">Block-Verlauf</span>
        <span className="label" style={{ opacity: 0.5 }}>{currentWeek}/{weeksTotal}</span>
      </div>
      <div style={{ height: 10 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${weeksTotal}, 1fr)`,
          gap: 6,
        }}
      >
        {Array.from({ length: weeksTotal }, (_, i) => {
          const weekNum = i + 1;
          const isCurrent = weekNum === currentWeek;
          return (
            <div
              key={weekNum}
              style={{
                borderLeft: isCurrent
                  ? "2px solid var(--color-session-threshold)"
                  : "2px solid var(--color-rule)",
                paddingLeft: 8,
                paddingTop: 6,
                paddingBottom: 6,
                background: isCurrent
                  ? "rgba(212, 168, 83, 0.06)"
                  : undefined,
                borderRadius: 4,
              }}
            >
              <div className="label" style={{ margin: 0, opacity: isCurrent ? 1 : 0.5 }}>
                W{weekNum}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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

      {/* Block-Verlauf */}
      <BlockVerlauf blockInfo={blockInfo} progress={progress} />
    </div>
  );
}
