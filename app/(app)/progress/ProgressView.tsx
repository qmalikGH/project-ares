"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/training/shared";
import { StatsSubNav } from "@/components/layout/StatsSubNav";

type GoalProgress = {
  primaryType: string;
  currentValue: { time: string };
  targetValue: { time: string };
  daysRemaining: number;
  daysToFirstTimeTrial: number | null;
  totalWeeksInPlan: number;
  weeksElapsed: number;
};

type VdotPoint = {
  date: string;
  vdot: number;
  source: string;
  note?: string;
};

type BlockStatus = {
  currentBlockNumber: number;
  currentPhaseName: string;
  currentPhaseId: string;
  weekInBlock: number;
  weeksTotal: number;
  blockStartDate: string;
  blockEndDatePlanned: string;
  daysToBlockReview: number;
  blockReviewType: string;
  blocksTotal: number;
  blocksCompleted: number;
};

type AdherenceStats = {
  scope: string;
  totalSessions: number;
  completed: number;
  modified: number;
  skipped: number;
  pending: number;
  adherenceScore: number;
  band: "good" | "warning" | "alarm";
};

type TIDComparison = {
  plan: { z1: number; z2: number; z3: number };
  actual: { z1: number; z2: number; z3: number };
  driftPP: { z1: number; z2: number; z3: number };
  totalRunMin: number;
};

type HrTID = {
  source: "hr";
  zones: { z1Max: number; z2Max: number; hrMax: number; hrRest: number };
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
  totalSec: number;
  unclassifiedSec: number;
  sessionsWithHr: number;
  sessionsWithoutHr: number;
  driftPP: { z1: number; z2: number; z3: number };
};

type GarminTID = {
  source: "garmin_hr_zones";
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
  totalSec: number;
  sessions: number;
  driftPP: { z1: number; z2: number; z3: number };
};

type PaceDrift = {
  hasDrift: boolean;
  driftType: "vdot_too_high" | "vdot_too_low" | "no_drift";
  affectedSessions: number;
  rpeDeviation: number;
  paceDeviation: number;
  recommendation: string;
  suggestedVdotDelta: number;
};

type Response =
  | { status: "NO_ACTIVE_GOAL" }
  | {
      status: "ok";
      goal: GoalProgress;
      vdotHistory: VdotPoint[];
      blockStatus: BlockStatus | null;
      adherence: { thisWeek: AdherenceStats; thisBlock: AdherenceStats };
      tid: TIDComparison | null;
      tidPlan: TIDComparison | null;
      tidHr: HrTID | null;
      tidGarmin: GarminTID | null;
      paceDrift: PaceDrift | null;
      effectiveVdot: number;
    };

export default function ProgressView() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/progress")
      .then((r) => r.json())
      .then((d) => setData(d as Response))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  if (error) {
    return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  }
  if (!data) {
    return <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>;
  }
  if (data.status === "NO_ACTIVE_GOAL") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-4">
        <StatsSubNav />
        <h1 className="text-2xl font-bold">Progress</h1>
        <p className="mt-2 text-muted-foreground">
          Kein aktives Goal. Bitte Onboarding abschließen.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <StatsSubNav />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
        <p className="text-sm text-muted-foreground">
          Wo stehst du, wie weit bist du vom Ziel.
        </p>
      </header>

      <GoalHeader goal={data.goal} />
      <VdotCalibrationStatus
        drift={data.paceDrift}
        effectiveVdot={data.effectiveVdot}
      />
      <VdotChart points={data.vdotHistory} />
      <WeightChart />
      <RelativeStrengthSection />
      {data.blockStatus && <BlockProgress blockStatus={data.blockStatus} />}
      <AdherenceSection week={data.adherence.thisWeek} block={data.adherence.thisBlock} />
      {data.tid && (
        <TIDComparisonSection
          tidPlan={data.tid}
          tidHr={data.tidHr ?? null}
          tidGarmin={data.tidGarmin ?? null}
        />
      )}
    </div>
  );
}

// ============================================
// Goal Header
// ============================================
function GoalHeader({ goal }: { goal: GoalProgress }) {
  const diff = parseDiff(goal.currentValue.time, goal.targetValue.time);
  const progress = Math.min(100, Math.round((goal.weeksElapsed / goal.totalWeeksInPlan) * 100));

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">5k Performance Goal</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {goal.primaryType.replace("_", " ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Verbleibend</p>
          <p className="text-sm font-semibold">
            {Math.floor(goal.daysRemaining / 7)}w {goal.daysRemaining % 7}d
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Aktuell</p>
          <p className="text-3xl font-bold tabular-nums">{goal.currentValue.time}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Ziel</p>
          <p className="text-3xl font-bold tabular-nums text-primary">
            {goal.targetValue.time}
          </p>
          {diff && (
            <p className="text-xs text-muted-foreground">Differenz: {diff}</p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Woche {goal.weeksElapsed} von {goal.totalWeeksInPlan}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {goal.daysToFirstTimeTrial !== null && (
        <p className="mt-3 text-xs text-muted-foreground">
          {goal.daysToFirstTimeTrial > 0
            ? `First Time Trial in ${goal.daysToFirstTimeTrial} Tagen`
            : "Time Trial steht heute / diese Woche an"}
        </p>
      )}
    </Card>
  );
}

function parseDiff(current: string, target: string): string | null {
  const toSec = (s: string) => {
    const [m, ss] = s.split(":").map(Number);
    return m * 60 + (ss ?? 0);
  };
  const c = toSec(current);
  const t = toSec(target);
  if (!isFinite(c) || !isFinite(t)) return null;
  const diff = c - t;
  const sign = diff < 0 ? "+" : diff > 0 ? "-" : "±";
  const abs = Math.abs(diff);
  const min = Math.floor(abs / 60);
  const sec = abs % 60;
  return `${sign}${min}:${sec.toString().padStart(2, "0")}`;
}

// ============================================
// VDOT Chart
// ============================================
function VdotChart({ points }: { points: VdotPoint[] }) {
  if (points.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">VDOT-Verlauf</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Noch keine VDOT-Daten — der Plan wurde noch nicht generiert.
        </p>
      </Card>
    );
  }

  // Split: measured = solid line, planned = dashed line
  const measured = points.filter((p) => p.source !== "PLANNED");
  const planned = points.filter((p) => p.source === "PLANNED");

  // Combined chart data: each point has either `vdotMeasured` or `vdotPlanned`
  type Row = {
    date: string;
    vdotMeasured?: number;
    vdotPlanned?: number;
    note?: string;
  };
  const dateMap = new Map<string, Row>();
  for (const p of measured) {
    const r = dateMap.get(p.date) ?? { date: p.date };
    r.vdotMeasured = p.vdot;
    r.note = p.note;
    dateMap.set(p.date, r);
  }
  for (const p of planned) {
    const r = dateMap.get(p.date) ?? { date: p.date };
    r.vdotPlanned = p.vdot;
    if (!r.note) r.note = p.note;
    dateMap.set(p.date, r);
  }
  const chartData = [...dateMap.values()].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );

  const minV =
    Math.min(...points.map((p) => p.vdot)) - 1;
  const maxV =
    Math.max(...points.map((p) => p.vdot)) + 1;

  return (
    <Card>
      <h2 className="text-lg font-semibold">VDOT-Verlauf</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        Gemessen (Solid) vs Plan (Dashed)
      </p>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              opacity={0.5}
            />
            <YAxis
              domain={[minV, maxV]}
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              opacity={0.5}
              width={32}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Row;
                return (
                  <div className="rounded-md border bg-card p-2 text-xs shadow-md">
                    <div className="font-semibold">{row.date}</div>
                    {row.vdotMeasured !== undefined && (
                      <div>Gemessen: VDOT {row.vdotMeasured}</div>
                    )}
                    {row.vdotPlanned !== undefined && (
                      <div className="text-muted-foreground">
                        Plan: VDOT {row.vdotPlanned}
                      </div>
                    )}
                    {row.note && (
                      <div className="text-muted-foreground mt-1">{row.note}</div>
                    )}
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="vdotMeasured"
              stroke="#7DD3FC"
              strokeWidth={1.5}
              dot={{ r: 3, fill: "#7DD3FC", stroke: "none" }}
              activeDot={{ r: 5, fill: "#7DD3FC", stroke: "none" }}
              connectNulls
              name="Gemessen"
            />
            <Line
              type="monotone"
              dataKey="vdotPlanned"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={{ r: 2, fill: "rgba(255,255,255,0.4)", stroke: "none" }}
              connectNulls
              name="Plan"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ============================================
// Weight Chart (Sprint v0.15)
// ============================================

type WeightEntry = { date: string; weightKg: number; avg7d: number };

type WeightHistoryResponse = {
  entries: WeightEntry[];
  currentWeightKg: number | null;
  targetWeightKg: number | null;
  weeklyRateKg: number | null;
  weeklyRatePct: number | null;
};

function WeightChart() {
  const [data, setData] = useState<WeightHistoryResponse | null>(null);

  useEffect(() => {
    fetch("/api/sensors/weight-history?days=90")
      .then((r) => r.json())
      .then((d) => setData(d as WeightHistoryResponse))
      .catch(() => {});
  }, []);

  if (!data || data.entries.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Gewicht</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Noch keine Gewichtsdaten. Gib dein Gewicht im Morning-Check-in ein.
        </p>
      </Card>
    );
  }

  const weights = data.entries.map((e) => e.weightKg);
  const minW = Math.floor(Math.min(...weights, data.targetWeightKg ?? Infinity) - 1);
  const maxW = Math.ceil(Math.max(...weights) + 1);

  // Rate status for badge
  const rateOk =
    data.weeklyRateKg !== null &&
    data.weeklyRatePct !== null &&
    data.weeklyRatePct >= 0.3 &&
    data.weeklyRatePct <= 1.0;
  const rateTooFast = data.weeklyRatePct !== null && data.weeklyRatePct > 1.0;

  return (
    <Card>
      <h2 className="text-lg font-semibold">Gewicht</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        Tageswerte (Punkte) · 7-Tage-Ø (Linie)
        {data.targetWeightKg && ` · Ziel: ${data.targetWeightKg} kg`}
      </p>

      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.entries} margin={{ top: 10, right: 12, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              opacity={0.5}
            />
            <YAxis
              domain={[minW, maxW]}
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              opacity={0.5}
              width={36}
              tickFormatter={(v: number) => `${v}`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as WeightEntry;
                return (
                  <div className="rounded-md border bg-card p-2 text-xs shadow-md">
                    <div className="font-semibold">{row.date}</div>
                    <div>
                      Gewicht: <span className="num">{row.weightKg}</span> kg
                    </div>
                    <div className="text-muted-foreground">
                      Ø 7d: <span className="num">{row.avg7d}</span> kg
                    </div>
                  </div>
                );
              }}
            />
            {data.targetWeightKg && (
              <ReferenceLine
                y={data.targetWeightKg}
                stroke="rgba(255,255,255,0.3)"
                strokeDasharray="6 3"
                label={{
                  value: `Ziel ${data.targetWeightKg}`,
                  position: "right",
                  fontSize: 10,
                  fill: "rgba(255,255,255,0.4)",
                }}
              />
            )}
            {/* Daily values — dots only, muted */}
            <Line
              type="monotone"
              dataKey="weightKg"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={0}
              dot={{ r: 2.5, fill: "rgba(255,255,255,0.35)", stroke: "none" }}
              activeDot={{ r: 4, fill: "rgba(255,255,255,0.5)", stroke: "none" }}
              connectNulls
              name="Tageswert"
            />
            {/* 7-day average — solid line, primary color */}
            <Line
              type="monotone"
              dataKey="avg7d"
              stroke="#7DD3FC"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, fill: "#7DD3FC", stroke: "none" }}
              connectNulls
              name="Ø 7 Tage"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stats row */}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {data.currentWeightKg && (
          <div>
            <span className="text-muted-foreground">Aktuell (Ø 7d):</span>{" "}
            <span className="num font-semibold">{data.currentWeightKg} kg</span>
          </div>
        )}
        {data.targetWeightKg && (
          <div>
            <span className="text-muted-foreground">Ziel:</span>{" "}
            <span className="num font-semibold">{data.targetWeightKg} kg</span>
          </div>
        )}
        {data.weeklyRateKg !== null && data.weeklyRateKg > 0 && (
          <div>
            <span className="text-muted-foreground">Rate:</span>{" "}
            <span
              className={`num font-semibold ${
                rateTooFast
                  ? "text-red-400"
                  : rateOk
                    ? "text-emerald-400"
                    : "text-yellow-300"
              }`}
            >
              -{data.weeklyRateKg} kg/Woche
              {rateOk && " ✓"}
              {rateTooFast && " ⚠"}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================
// Relative Strength (×BW) — Sprint v0.15
// ============================================

// Main compound lifts to show ×BW for
const XBWLIFTS: { key: string; label: string }[] = [
  { key: "Hex Bar Deadlift", label: "Hex Bar DL" },
  { key: "Bench Press", label: "Bench" },
  { key: "Conventional Deadlift", label: "Conv. DL" },
  { key: "Back Squat", label: "Squat" },
];

function RelativeStrengthSection() {
  const [exercises, setExercises] = useState<
    { name: string; currentRM: number | null }[]
  >([]);
  const [weightKg, setWeightKg] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/settings/exercise-max")
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok") {
          setExercises(d.exercises ?? []);
          setWeightKg(d.currentWeightKg ?? null);
        }
      })
      .catch(() => {});
  }, []);

  if (!weightKg || weightKg <= 0) return null; // Only show when weight is known

  // Filter to main compound lifts that have a 1RM
  const rows = XBWLIFTS.map((lift) => {
    const ex = exercises.find((e) => e.name === lift.key);
    const rm = ex?.currentRM ?? null;
    const ratio = rm && weightKg ? Math.round((rm / weightKg) * 100) / 100 : null;
    return { ...lift, rm, ratio };
  }).filter((r) => r.rm !== null);

  if (rows.length === 0) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold">Relative Kraft (×BW)</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        Gewichtsbasis: {weightKg} kg (Ø 7d)
      </p>
      <div className="mt-4 space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between">
            <span className="text-sm font-medium">{r.label}</span>
            <div className="flex items-baseline gap-3 tabular-nums">
              <span className="text-sm text-muted-foreground">
                {r.rm} kg
              </span>
              <span className="text-lg font-bold text-[#7DD3FC]">
                {r.ratio!.toFixed(2)}×
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================
// Block Progress
// ============================================
function BlockProgress({ blockStatus }: { blockStatus: BlockStatus }) {
  const blockProgress = Math.min(
    100,
    Math.round((blockStatus.weekInBlock / blockStatus.weeksTotal) * 100),
  );
  const phaseLabel = prettyPhase(blockStatus.currentPhaseName);

  return (
    <Card>
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">Aktueller Block</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Block {blockStatus.currentBlockNumber} · {phaseLabel}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          Wo {blockStatus.weekInBlock} von {blockStatus.weeksTotal}
        </span>
      </header>

      <div className="mt-4">
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${blockProgress}%` }}
          />
        </div>
      </div>

      <div className="mt-4 text-sm">
        <p>
          <span className="text-muted-foreground">Block-Review:</span>{" "}
          <span className="font-medium">
            {blockStatus.blockEndDatePlanned} ({blockStatus.daysToBlockReview} Tage)
          </span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Geplanter Test: {blockStatus.blockReviewType}
        </p>
      </div>

      {/* Block-of-blocks indicator */}
      <div className="mt-5 flex gap-1.5">
        {Array.from({ length: blockStatus.blocksTotal }).map((_, i) => {
          const num = i + 1;
          const isCompleted = num <= blockStatus.blocksCompleted;
          const isCurrent = num === blockStatus.currentBlockNumber;
          return (
            <div
              key={num}
              className={`flex-1 h-2 rounded ${
                isCompleted
                  ? "bg-primary"
                  : isCurrent
                  ? "bg-primary/40 border border-primary"
                  : "bg-muted"
              }`}
              title={`Block ${num}`}
            />
          );
        })}
      </div>

      {blockStatus.daysToBlockReview <= 7 && (
        <Link
          href={`/blocks/${blockStatus.currentPhaseId}/review`}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          → Block-Review öffnen
        </Link>
      )}
    </Card>
  );
}

function prettyPhase(phaseName: string): string {
  const map: Record<string, string> = {
    ACCUMULATION_AEROBIC_BASE: "Aerobic Base",
    ACCUMULATION_THRESHOLD_INTRO: "Threshold Intro",
    TRANSMUTATION_THRESHOLD: "Threshold",
    TRANSMUTATION_VO2MAX: "VO2max",
    REALIZATION_PEAK_PERFORMANCE: "Peak Performance",
  };
  return map[phaseName] ?? phaseName;
}

// ============================================
// Adherence
// ============================================
function AdherenceSection({
  week,
  block,
}: {
  week: AdherenceStats;
  block: AdherenceStats;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <AdherenceCard label="Diese Woche" stats={week} />
      <AdherenceCard label="Dieser Block" stats={block} />
    </div>
  );
}

function AdherenceCard({ label, stats }: { label: string; stats: AdherenceStats }) {
  const bandClasses = {
    good: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
    warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-800 dark:text-yellow-300",
    alarm: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400",
  } as const;

  return (
    <div className={`rounded-lg border p-5 ${bandClasses[stats.band]}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-3xl font-bold tabular-nums">{stats.adherenceScore}%</p>
        <p className="text-xs opacity-70">
          {stats.completed + stats.modified}/{stats.totalSessions} Sessions
        </p>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
        <div className="text-center">
          <div className="font-bold tabular-nums">{stats.completed}</div>
          <div className="opacity-70">✓</div>
        </div>
        <div className="text-center">
          <div className="font-bold tabular-nums">{stats.modified}</div>
          <div className="opacity-70">↻</div>
        </div>
        <div className="text-center">
          <div className="font-bold tabular-nums">{stats.skipped}</div>
          <div className="opacity-70">✗</div>
        </div>
        <div className="text-center">
          <div className="font-bold tabular-nums">{stats.pending}</div>
          <div className="opacity-70">⚪</div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// TID Comparison (Plan vs HR vs Garmin native)
// ============================================
type TidMode = "plan" | "hr" | "garmin";

function TIDComparisonSection({
  tidPlan,
  tidHr,
  tidGarmin,
}: {
  tidPlan: TIDComparison;
  tidHr: HrTID | null;
  tidGarmin: GarminTID | null;
}) {
  const hasHr = tidHr !== null && tidHr.totalSec - tidHr.unclassifiedSec > 0;
  const hasGarmin = tidGarmin !== null && tidGarmin.totalSec > 0;

  // Default-mode hierarchy (Sprint v0.7): Garmin > HR-splits > Plan.
  const initialMode: TidMode = hasGarmin ? "garmin" : hasHr ? "hr" : "plan";
  const [mode, setMode] = useState<TidMode>(initialMode);

  useEffect(() => {
    if (hasGarmin) setMode("garmin");
    else if (hasHr) setMode("hr");
  }, [hasGarmin, hasHr]);

  const subtitle =
    mode === "plan"
      ? `Plan vs Actual (Plan-Zonen) · ${tidPlan.totalRunMin}min Run`
      : mode === "hr" && tidHr
        ? `Plan vs Actual (HR-Zonen) · ${Math.round(
            (tidHr.totalSec - tidHr.unclassifiedSec) / 60,
          )}min mit HR`
        : mode === "garmin" && tidGarmin
          ? `Plan vs Actual (Garmin native) · ${tidGarmin.sessions} Runs · ${Math.round(tidGarmin.totalSec / 60)}min`
          : "";

  return (
    <Card>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">TID-Distribution</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="flex rounded-md border bg-background text-xs">
          <button
            type="button"
            onClick={() => setMode("plan")}
            className={`px-3 py-1 transition-colors ${
              mode === "plan"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Plan
          </button>
          <button
            type="button"
            onClick={() => hasHr && setMode("hr")}
            disabled={!hasHr}
            className={`px-3 py-1 transition-colors ${
              mode === "hr"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            } ${!hasHr ? "opacity-40 cursor-not-allowed" : ""}`}
            title={
              hasHr
                ? "HR-Zonen aus Splits (Karvonen HRR)"
                : "Setze HRmax + HRrest in Settings für HR-basierte TID."
            }
          >
            HR
          </button>
          <button
            type="button"
            onClick={() => hasGarmin && setMode("garmin")}
            disabled={!hasGarmin}
            className={`px-3 py-1 transition-colors ${
              mode === "garmin"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            } ${!hasGarmin ? "opacity-40 cursor-not-allowed" : ""}`}
            title={
              hasGarmin
                ? "Garmin native HR-Time-In-Zones (höchste Genauigkeit)"
                : "Erfordert Garmin-imported Run-Workouts mit HR-Zone-Daten."
            }
          >
            Garmin ★
          </button>
        </div>
      </header>

      {mode === "plan" ? (
        <PlanTidPanel tid={tidPlan} />
      ) : mode === "hr" && tidHr ? (
        <HrTidPanel tid={tidHr} plan={tidPlan.plan} />
      ) : mode === "garmin" && tidGarmin ? (
        <GarminTidPanel tid={tidGarmin} plan={tidPlan.plan} />
      ) : null}
    </Card>
  );
}

function GarminTidPanel({
  tid,
  plan,
}: {
  tid: GarminTID;
  plan: { z1: number; z2: number; z3: number };
}) {
  const actual = { z1: tid.z1Pct, z2: tid.z2Pct, z3: tid.z3Pct };
  const significantDrift = Math.max(
    Math.abs(tid.driftPP.z1),
    Math.abs(tid.driftPP.z2),
    Math.abs(tid.driftPP.z3),
  );
  const driftWarn = significantDrift > 10;
  const z2HighWarn = tid.z2Pct > 25;

  return (
    <>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Quelle: Garmin time-in-zones pro Activity (Z1+Z2 → polar Z1 · Z3+Z4 → polar Z2 · Z5 → polar Z3)
      </div>
      <div className="mt-3 space-y-3">
        <TIDBar label="Plan" tid={plan} />
        <TIDBar label="Garmin" tid={actual} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {(["z1", "z2", "z3"] as const).map((zone) => {
          const drift = tid.driftPP[zone];
          const sign = drift > 0 ? "+" : "";
          const cls =
            Math.abs(drift) > 10
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground";
          return (
            <div key={zone} className={cls}>
              <div className="opacity-70 uppercase">{zone}</div>
              <div className="font-semibold tabular-nums">
                {sign}
                {drift.toFixed(1)}pp
              </div>
            </div>
          );
        })}
      </div>
      {z2HighWarn && (
        <div className="mt-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          Z2 &gt; 25% — Mitteltempo-Falle. Polarisiertes Training will Z1 hoch, Z2 niedrig.
        </div>
      )}
      {driftWarn && !z2HighWarn && (
        <div className="mt-3 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          Distribution-Drift {">"} 10pp vs Plan.
        </div>
      )}
      <div className="mt-3 text-[11px] text-muted-foreground">
        {tid.sessions} Runs aggregiert · {Math.round(tid.totalSec / 60)}min total
      </div>
    </>
  );
}

function PlanTidPanel({ tid }: { tid: TIDComparison }) {
  const significantDrift = Math.max(
    Math.abs(tid.driftPP.z1),
    Math.abs(tid.driftPP.z2),
    Math.abs(tid.driftPP.z3),
  );
  const driftWarn = significantDrift > 10;

  return (
    <>
      <div className="mt-4 space-y-3">
        <TIDBar label="Plan" tid={tid.plan} />
        <TIDBar label="Actual" tid={tid.actual} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {(["z1", "z2", "z3"] as const).map((zone) => {
          const drift = tid.driftPP[zone];
          const sign = drift > 0 ? "+" : "";
          const cls =
            Math.abs(drift) > 10
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground";
          return (
            <div key={zone} className={cls}>
              <div className="opacity-70 uppercase">{zone}</div>
              <div className="font-semibold tabular-nums">
                {sign}
                {drift.toFixed(1)}pp
              </div>
            </div>
          );
        })}
      </div>

      {driftWarn && (
        <div className="mt-3 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          Distribution-Drift {">"} 10pp — TID weicht deutlich vom Plan ab.
        </div>
      )}

      {tid.totalRunMin === 0 && (
        <p className="mt-3 text-xs text-muted-foreground italic">
          Noch keine Run-Sessions in diesem Block abgeschlossen.
        </p>
      )}
    </>
  );
}

function HrTidPanel({
  tid,
  plan,
}: {
  tid: HrTID;
  plan: { z1: number; z2: number; z3: number };
}) {
  const actual = { z1: tid.z1Pct, z2: tid.z2Pct, z3: tid.z3Pct };
  const classifiedSec = tid.totalSec - tid.unclassifiedSec;
  const significantDrift = Math.max(
    Math.abs(tid.driftPP.z1),
    Math.abs(tid.driftPP.z2),
    Math.abs(tid.driftPP.z3),
  );
  const driftWarn = significantDrift > 10;
  const z2HighWarn = tid.z2Pct > 25;
  const z1LowWarn = tid.z1Pct < 70 && classifiedSec > 0;

  return (
    <>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Karvonen HRR · Z1 ≤ {tid.zones.z1Max} · Z2 ≤ {tid.zones.z2Max} · Z3 &gt;{" "}
        {tid.zones.z2Max} (HRmax {tid.zones.hrMax}, HRrest {tid.zones.hrRest})
      </div>

      <div className="mt-4 space-y-3">
        <TIDBar label="Plan" tid={plan} />
        <TIDBar label="HR Actual" tid={actual} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {(["z1", "z2", "z3"] as const).map((zone) => {
          const drift = tid.driftPP[zone];
          const sign = drift > 0 ? "+" : "";
          const cls =
            Math.abs(drift) > 10
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground";
          return (
            <div key={zone} className={cls}>
              <div className="opacity-70 uppercase">{zone}</div>
              <div className="font-semibold tabular-nums">
                {sign}
                {drift.toFixed(1)}pp
              </div>
            </div>
          );
        })}
      </div>

      {z2HighWarn && (
        <div className="mt-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          Z2 &gt; 25% — Mitteltempo-Falle. Polarisiertes Training will Z1 hoch, Z2 niedrig.
        </div>
      )}
      {z1LowWarn && !z2HighWarn && (
        <div className="mt-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          Z1 &lt; 70% — easy runs gehen tendenziell zu hart. Drossel HR auf{" "}
          ≤{tid.zones.z1Max} bpm.
        </div>
      )}
      {driftWarn && !z2HighWarn && !z1LowWarn && (
        <div className="mt-3 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          Distribution-Drift {">"} 10pp vs Plan.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{tid.sessionsWithHr} Sessions mit HR</span>
        <span>·</span>
        <span>{tid.sessionsWithoutHr} ohne HR</span>
        {tid.unclassifiedSec > 0 && (
          <>
            <span>·</span>
            <span>{Math.round(tid.unclassifiedSec / 60)}min nicht klassifiziert</span>
          </>
        )}
      </div>

      {classifiedSec === 0 && (
        <p className="mt-3 text-xs text-muted-foreground italic">
          Noch keine Run-Sessions mit HR-Daten in diesem Block.
        </p>
      )}
    </>
  );
}

function TIDBar({ label, tid }: { label: string; tid: { z1: number; z2: number; z3: number } }) {
  const total = tid.z1 + tid.z2 + tid.z3;
  if (total === 0) {
    return (
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span>{label}</span>
          <span className="text-muted-foreground italic">keine Daten</span>
        </div>
        <div className="h-6 w-full rounded bg-muted/40" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {Math.round(tid.z1)}/{Math.round(tid.z2)}/{Math.round(tid.z3)}
        </span>
      </div>
      <div className="flex h-6 w-full rounded overflow-hidden">
        <div
          className="bg-emerald-500 flex items-center justify-center text-[10px] text-white font-semibold"
          style={{ width: `${tid.z1}%` }}
          title={`Z1: ${tid.z1.toFixed(1)}%`}
        >
          {tid.z1 >= 12 ? "Z1" : ""}
        </div>
        <div
          className="bg-yellow-500 flex items-center justify-center text-[10px] text-white font-semibold"
          style={{ width: `${tid.z2}%` }}
          title={`Z2: ${tid.z2.toFixed(1)}%`}
        >
          {tid.z2 >= 12 ? "Z2" : ""}
        </div>
        <div
          className="bg-red-500 flex items-center justify-center text-[10px] text-white font-semibold"
          style={{ width: `${tid.z3}%` }}
          title={`Z3: ${tid.z3.toFixed(1)}%`}
        >
          {tid.z3 >= 12 ? "Z3" : ""}
        </div>
      </div>
    </div>
  );
}

// ============================================
// VDOT-Calibration-Status (Sprint v0.7)
// ============================================
function VdotCalibrationStatus({
  drift,
  effectiveVdot,
}: {
  drift: PaceDrift | null;
  effectiveVdot: number;
}) {
  // Hide entirely when there's no signal yet (< 3 Easy Runs).
  if (!drift || (!drift.hasDrift && drift.affectedSessions === 0)) {
    return null;
  }

  if (!drift.hasDrift) {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              VDOT-Calibration: passt
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Effective VDOT {effectiveVdot}. Pace + RPE liegen im erwarteten Bereich.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const suggestedVdot = effectiveVdot + drift.suggestedVdotDelta;
  const direction = drift.driftType === "vdot_too_high" ? "zu hoch" : "zu niedrig";

  return (
    <Card className="border-orange-500/30 bg-orange-500/10">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-orange-900 dark:text-orange-200">
            VDOT-Drift erkannt: aktueller VDOT {direction}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Aus den letzten {drift.affectedSessions} Sessions abgeleitet ·
            Effective VDOT {effectiveVdot}
          </p>
        </div>
      </header>

      <p className="mt-3 text-sm leading-relaxed">{drift.recommendation}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Metric label="Ø RPE-Δ" value={`${drift.rpeDeviation >= 0 ? "+" : ""}${drift.rpeDeviation.toFixed(1)}`} />
        <Metric label="Ø Pace-Δ" value={`${(drift.paceDeviation * 100).toFixed(1)}%`} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/settings?vdotPrefill=${suggestedVdot}`}
          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          VDOT auf {suggestedVdot} anpassen
        </Link>
        <span className="text-[11px] text-muted-foreground self-center">
          Override öffnet sich mit pre-fillet Wert. Engine wendet erst nach Bestätigung an.
        </span>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/60 px-2 py-1.5 border border-border/60">
      <div className="opacity-70 uppercase text-[10px]">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
