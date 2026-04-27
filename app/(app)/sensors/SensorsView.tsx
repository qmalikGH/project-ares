"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/training/shared";

// ============================================
// Types
// ============================================
type Snapshot = {
  date: string;
  garmin: {
    hrvRmssd: number | null;
    hrvStatus: string | null;
    sleepScore: number | null;
    sleepDurationMin: number | null;
    bodyBatteryMorning: number | null;
    rhr: number | null;
  };
  user: {
    subjectiveRecovery: number | null;
    morningStiffness: number | null;
    stairsScore: number | null;
  };
  computed: {
    readinessScore: number | null;
    readinessBand: string | null;
    kneeScore: number | null;
    therapyPhase: string | null;
  };
  baselines: {
    hrv28d: { avg: number; sd: number } | null;
    sleep28d: { avg: number } | null;
    rhr28d: { avg: number; sd: number } | null;
    readiness28d: { avg: number } | null;
  };
  lastSync: string | null;
};

type TrendPoint = {
  date: string;
  hrv: number | null;
  sleepScore: number | null;
  sleepDurationMin: number | null;
  bodyBatteryMorning: number | null;
  rhr: number | null;
  readinessScore: number | null;
  acwr: number | null;
  acwrBand: string | null;
  dailyLoad: number | null;
  morningStiffness: number | null;
  stairsScore: number | null;
};

type SyncEntry = {
  syncedAt: string;
  status: string;
  hrvSyncOk: boolean;
  sleepSyncOk: boolean;
  bodyBatterySyncOk: boolean;
  rhrSyncOk: boolean;
  activitiesSyncOk: boolean;
  errorType: string | null;
  errorMessage: string | null;
};

type SensorsResponse = {
  status: string;
  snapshot: Snapshot | null;
  trend: TrendPoint[];
  syncHealth: SyncEntry[];
};

// ============================================
// Page
// ============================================
export default function SensorsView() {
  const [data, setData] = useState<SensorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sensors/insights")
      .then((r) => r.json())
      .then((d) => setData(d as SensorsResponse))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  if (error)
    return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  if (!data)
    return <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sensors</h1>
        <p className="text-sm text-muted-foreground">
          Garmin-Werte heute vs Baseline · 28-Tage-Trends · Sync-Health
        </p>
      </header>

      {data.snapshot ? (
        <TodaySnapshotCard s={data.snapshot} />
      ) : (
        <Card>
          <p className="text-muted-foreground">
            Noch keine Sensordaten für heute. Drücke &bdquo;sync now&ldquo; oben rechts.
          </p>
        </Card>
      )}

      <TrendCharts trend={data.trend} baselines={data.snapshot?.baselines ?? null} />
      <KneeChart trend={data.trend} />
      <ACWRChart trend={data.trend} />
      <SyncHealthTable entries={data.syncHealth} />
    </div>
  );
}

// ============================================
// Today snapshot
// ============================================
function TodaySnapshotCard({ s }: { s: Snapshot }) {
  type Row = {
    label: string;
    value: number | string | null;
    unit: string;
    baseline: number | null;
    band: string | null;
    arrow?: string;
  };

  const arrow = (val: number | null, base: number | null, sd: number | null, inverted = false): string => {
    if (val == null || base == null) return "—";
    if (sd == null || sd === 0) return "→";
    let z = (val - base) / sd;
    if (inverted) z = -z;
    if (z >= 2) return "↑↑";
    if (z >= 0.5) return "↑";
    if (z <= -2) return "↓↓";
    if (z <= -0.5) return "↓";
    return "→";
  };

  const rows: Row[] = [
    {
      label: "HRV (RMSSD)",
      value: s.garmin.hrvRmssd,
      unit: "ms",
      baseline: s.baselines.hrv28d?.avg ?? null,
      band: s.garmin.hrvStatus,
      arrow: arrow(s.garmin.hrvRmssd, s.baselines.hrv28d?.avg ?? null, s.baselines.hrv28d?.sd ?? null),
    },
    {
      label: "Sleep Score",
      value: s.garmin.sleepScore,
      unit: "/100",
      baseline: s.baselines.sleep28d?.avg ?? null,
      band: s.garmin.sleepDurationMin
        ? `${Math.floor(s.garmin.sleepDurationMin / 60)}h ${s.garmin.sleepDurationMin % 60}min`
        : null,
    },
    {
      label: "Body Battery",
      value: s.garmin.bodyBatteryMorning,
      unit: "/100",
      baseline: null,
      band: null,
    },
    {
      label: "RHR",
      value: s.garmin.rhr,
      unit: "bpm",
      baseline: s.baselines.rhr28d?.avg ?? null,
      band: null,
      arrow: arrow(
        s.garmin.rhr,
        s.baselines.rhr28d?.avg ?? null,
        s.baselines.rhr28d?.sd ?? null,
        true,
      ),
    },
    {
      label: "Readiness",
      value: s.computed.readinessScore,
      unit: "/100",
      baseline: s.baselines.readiness28d?.avg
        ? Math.round(s.baselines.readiness28d.avg)
        : null,
      band: s.computed.readinessBand,
    },
  ];

  const lastSyncStr = s.lastSync
    ? (() => {
        const min = Math.max(0, Math.floor((Date.now() - new Date(s.lastSync!).getTime()) / 60000));
        if (min < 1) return "gerade";
        if (min < 60) return `vor ${min} min`;
        return `vor ${Math.round(min / 60)}h`;
      })()
    : "noch nie";

  return (
    <Card>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Heute · {s.date}</h2>
        <span className="text-xs text-muted-foreground">Letzter Sync: {lastSyncStr}</span>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left font-normal py-1">Metrik</th>
            <th className="text-right font-normal py-1">Heute</th>
            <th className="text-right font-normal py-1">Baseline (28d)</th>
            <th className="text-center font-normal py-1 w-12">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2">
                <span className="font-medium">{r.label}</span>
                {r.band && <span className="ml-2 text-xs text-muted-foreground">{r.band}</span>}
              </td>
              <td className="py-2 text-right tabular-nums font-semibold">
                {r.value !== null ? `${r.value}${r.unit}` : "—"}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {r.baseline !== null ? `${Math.round(r.baseline * 10) / 10}${r.unit}` : "—"}
              </td>
              <td className="py-2 text-center text-lg">{r.arrow ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ============================================
// 4 Trend charts (HRV, Sleep, RHR, Readiness)
// ============================================
function TrendCharts({
  trend,
  baselines,
}: {
  trend: TrendPoint[];
  baselines: Snapshot["baselines"] | null;
}) {
  if (trend.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">28-Tage-Trends</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Noch keine Sensor-Historie — Trends erscheinen nach mehreren Tagen.
        </p>
      </Card>
    );
  }

  const charts: Array<{ key: keyof TrendPoint; label: string; color: string; baseline?: { avg: number; sd?: number } }> = [
    {
      key: "hrv",
      label: "HRV (ms)",
      color: "hsl(220 70% 50%)",
      baseline: baselines?.hrv28d ?? undefined,
    },
    {
      key: "sleepScore",
      label: "Sleep Score",
      color: "hsl(280 60% 55%)",
      baseline: baselines?.sleep28d ? { avg: baselines.sleep28d.avg } : undefined,
    },
    {
      key: "rhr",
      label: "RHR (bpm)",
      color: "hsl(0 70% 55%)",
      baseline: baselines?.rhr28d ?? undefined,
    },
    {
      key: "readinessScore",
      label: "Readiness",
      color: "hsl(140 60% 45%)",
      baseline: baselines?.readiness28d ? { avg: baselines.readiness28d.avg } : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {charts.map((c) => (
        <TrendChart
          key={c.key as string}
          trend={trend}
          dataKey={c.key}
          label={c.label}
          color={c.color}
          baseline={c.baseline}
        />
      ))}
    </div>
  );
}

function TrendChart({
  trend,
  dataKey,
  label,
  color,
  baseline,
}: {
  trend: TrendPoint[];
  dataKey: keyof TrendPoint;
  label: string;
  color: string;
  baseline?: { avg: number; sd?: number };
}) {

  const dataWithVal = trend.filter((p) => p[dataKey] != null);
  if (dataWithVal.length === 0) {
    return (
      <Card>
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="mt-2 text-xs text-muted-foreground">Keine Daten</p>
      </Card>
    );
  }

  const baselineUpper = baseline && baseline.sd != null ? baseline.avg + baseline.sd : null;
  const baselineLower = baseline && baseline.sd != null ? baseline.avg - baseline.sd : null;

  return (
    <Card>
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        {baseline && (
          <span className="text-xs text-muted-foreground">
            Avg {Math.round(baseline.avg * 10) / 10}
            {baseline.sd != null && ` ± ${Math.round(baseline.sd * 10) / 10}`}
          </span>
        )}
      </header>
      <div className="mt-3 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 5, right: 5, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              opacity={0.5}
              minTickGap={20}
            />
            <YAxis tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} width={30} />
            {baselineUpper !== null && baselineLower !== null && (
              <ReferenceArea
                y1={baselineLower}
                y2={baselineUpper}
                fill={color}
                fillOpacity={0.08}
                stroke="none"
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const v = payload[0].value as number | null;
                const date = (payload[0].payload as TrendPoint).date;
                return (
                  <div className="rounded-md border bg-card p-2 text-xs shadow-md">
                    <div className="font-semibold">{date}</div>
                    <div>{label}: {v ?? "—"}</div>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ============================================
// Knee Chart
// ============================================
function KneeChart({ trend }: { trend: TrendPoint[] }) {
  const hasKnee = trend.some(
    (p) => p.morningStiffness != null || p.stairsScore != null,
  );
  if (!hasKnee) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Knee-Verlauf</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Noch keine Knee-Daten — wird täglich beim Morning Check-in erfasst.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">Knee-Verlauf (28d)</h2>
        <span className="text-xs text-muted-foreground">
          1 = schmerzfrei, 10 = stark
        </span>
      </header>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              opacity={0.5}
              minTickGap={20}
            />
            <YAxis
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              opacity={0.5}
              width={28}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as TrendPoint;
                return (
                  <div className="rounded-md border bg-card p-2 text-xs shadow-md space-y-0.5">
                    <div className="font-semibold">{p.date}</div>
                    {p.morningStiffness != null && (
                      <div>Stiffness: {p.morningStiffness}/10</div>
                    )}
                    {p.stairsScore != null && (
                      <div>Stairs: {p.stairsScore}/10</div>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="morningStiffness"
              name="Morning Stiffness"
              stroke="hsl(30 80% 55%)"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="stairsScore"
              name="Stairs"
              stroke="hsl(0 70% 55%)"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ============================================
// ACWR Chart with band-colored backgrounds
// ============================================
function ACWRChart({ trend }: { trend: TrendPoint[] }) {
  const hasData = trend.some((p) => p.acwr != null || p.dailyLoad != null);

  // Hooks must run unconditionally (rules-of-hooks); guard the *render*, not
  // the hooks themselves.
  const lastBand = useMemo(() => {
    const r = [...trend].reverse().find((p) => p.acwrBand);
    return r?.acwrBand ?? "BASELINE_BUILDING";
  }, [trend]);

  const lastAcwr = useMemo(() => {
    const r = [...trend].reverse().find((p) => p.acwr != null);
    return r?.acwr ?? null;
  }, [trend]);

  if (!hasData) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">ACWR + Daily Load</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Noch keine Load-Daten — Workouts müssen abgeschlossen werden.
        </p>
      </Card>
    );
  }

  const bandLabel: Record<string, string> = {
    BASELINE_BUILDING: "Baseline",
    LOW: "Low",
    OPTIMAL: "Optimal",
    HIGH: "High",
    DANGER: "Danger",
  };

  const bandClass: Record<string, string> = {
    BASELINE_BUILDING: "bg-slate-500/10 text-slate-700 dark:text-slate-400",
    LOW: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    OPTIMAL: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    HIGH: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    DANGER: "bg-red-500/10 text-red-700 dark:text-red-400",
  };

  return (
    <Card>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">ACWR + Daily Load</h2>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded ${bandClass[lastBand] ?? ""}`}
        >
          {lastAcwr != null ? lastAcwr.toFixed(2) : "—"} · {bandLabel[lastBand] ?? lastBand}
        </span>
      </header>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={trend} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              opacity={0.5}
              minTickGap={20}
            />
            <YAxis
              yAxisId="load"
              orientation="left"
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              opacity={0.5}
              width={32}
              label={{ value: "Load (AU)", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "currentColor", opacity: 0.5 } }}
            />
            <YAxis
              yAxisId="acwr"
              orientation="right"
              domain={[0, 2]}
              ticks={[0, 0.8, 1.3, 1.5, 2]}
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              opacity={0.5}
              width={32}
              label={{ value: "ACWR", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "currentColor", opacity: 0.5 } }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as TrendPoint;
                return (
                  <div className="rounded-md border bg-card p-2 text-xs shadow-md space-y-0.5">
                    <div className="font-semibold">{p.date}</div>
                    {p.dailyLoad != null && <div>Load: {Math.round(p.dailyLoad)} AU</div>}
                    {p.acwr != null && <div>ACWR: {p.acwr.toFixed(2)} ({p.acwrBand})</div>}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="load" dataKey="dailyLoad" name="Daily Load" fill="hsl(220 60% 60%)" opacity={0.5} />
            <Line
              yAxisId="acwr"
              type="monotone"
              dataKey="acwr"
              name="ACWR"
              stroke="hsl(0 70% 50%)"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ============================================
// Sync Health Table
// ============================================
function SyncHealthTable({ entries }: { entries: SyncEntry[] }) {
  if (entries.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Sync-Health</h2>
        <p className="mt-2 text-sm text-muted-foreground">Keine Sync-Versuche geloggt.</p>
      </Card>
    );
  }

  const statusBadge = (s: string) => {
    if (s === "SUCCESS")
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    if (s === "PARTIAL")
      return "bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 border-yellow-500/30";
    return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30";
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Sync-Health (letzte {entries.length})</h2>
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal px-2 py-1">Zeit</th>
              <th className="text-left font-normal px-2 py-1">Status</th>
              <th className="text-center font-normal px-2 py-1">HRV</th>
              <th className="text-center font-normal px-2 py-1">Sleep</th>
              <th className="text-center font-normal px-2 py-1">Battery</th>
              <th className="text-center font-normal px-2 py-1">RHR</th>
              <th className="text-center font-normal px-2 py-1">Activities</th>
              <th className="text-left font-normal px-2 py-1">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5 tabular-nums">{fmtDate(e.syncedAt)}</td>
                <td className="px-2 py-1.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusBadge(e.status)}`}
                  >
                    {e.status}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">{e.hrvSyncOk ? "✓" : "✗"}</td>
                <td className="px-2 py-1.5 text-center">{e.sleepSyncOk ? "✓" : "✗"}</td>
                <td className="px-2 py-1.5 text-center">{e.bodyBatterySyncOk ? "✓" : "✗"}</td>
                <td className="px-2 py-1.5 text-center">{e.rhrSyncOk ? "✓" : "✗"}</td>
                <td className="px-2 py-1.5 text-center">{e.activitiesSyncOk ? "✓" : "✗"}</td>
                <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[180px]">
                  {e.errorType ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
