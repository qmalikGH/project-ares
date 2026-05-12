import { db } from "@/lib/db/client";
import { userTodayDynamic } from "@/lib/date";
import { dayKey, getRecentSensorData } from "@/lib/db/queries/sensors";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import { ExecutedSessionSchema } from "@/lib/coach-engine/types";
import type { PhaseConfig, SessionPlan } from "@/lib/coach-engine/types";
import { DAY_TYPE_BY_WEEKDAY } from "@/lib/nutrition/day-type";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import type {
  CoachingExport,
  PeriodizationSection,
  PerformanceMarkersSection,
  TrainingHistorySection,
  WellnessSection,
  CaloriesSection,
  CalorieDay,
  HealthSection,
  UpcomingSection,
  AthleteSection,
  NutritionSection,
  NutritionDayLog,
  TrainingSession,
  PlannedSessionData,
  ActualSessionData,
  WellnessDay,
  WellnessBaselines,
  PainEntry,
  UpcomingSession,
} from "./types";
import { getDayType } from "@/lib/nutrition/day-type";
import { DEFICIT_KCAL } from "@/lib/nutrition/daily-adjustment";
import type { DailyAdjustment } from "@/lib/nutrition/types";

// ── Pure helpers ──────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ISO_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function formatDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDayOfWeek(date: Date): string {
  return DAY_NAMES[date.getUTCDay()];
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function computeComplianceRate(completed: number, total: number): number {
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

function nullAvg(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  if (nums.length < 7) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// ── safeSection ───────────────────────────────────────────────────────────

export async function safeSection<T>(fn: () => Promise<T>, fallback: T): Promise<T>;
export async function safeSection<T>(fn: () => Promise<T>): Promise<T | null>;
export async function safeSection<T>(fn: () => Promise<T>, fallback?: T): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return fallback !== undefined ? fallback : null;
  }
}

// ── Section defaults ─────────────────────────────────────────────────────

const DEFAULT_TRAINING_HISTORY: TrainingHistorySection = {
  last28Days: { planned: 0, completed: 0, skipped: 0, complianceRate: 0 },
  sessions: [],
  volumeTrends: { weeklyRunKm: [], weeklyStrengthSets: [] },
};

const DEFAULT_WELLNESS: WellnessSection = { days: [], baselines: null };

const DEFAULT_CALORIES: CaloriesSection = {
  days: [],
  averageByDayType: { strength_run: null, threshold: null, long_run: null, rest: null },
};

const DEFAULT_HEALTH: HealthSection = {
  therapyPhase: null,
  activeInjuries: [],
  painHistory: [],
  preventionExercises: [],
};

const DEFAULT_UPCOMING: UpcomingSection = { sessions: [] };

const DEFAULT_ATHLETE: AthleteSection = {
  weightKg: null,
  targetWeightKg: null,
  timezone: null,
  restDays: [],
  preferredLongRunDay: "Saturday",
  therapyPhase: null,
};

// ── Section builders ─────────────────────────────────────────────────────

async function buildPeriodization(userId: string, today: Date): Promise<PeriodizationSection> {
  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: {
      goal: true,
      phases: {
        include: { weeklyPlans: true },
        orderBy: { blockNumber: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!macro) throw new Error("No active macrocycle");

  const todayMs = dayKey(today).getTime();
  type MacroPhase = (typeof macro.phases)[number];
  const currentPhase = macro.phases.find(
    (p: MacroPhase) =>
      dayKey(p.startDate).getTime() <= todayMs && todayMs < dayKey(p.plannedEndDate).getTime(),
  );
  if (!currentPhase) throw new Error("No current phase for today");

  // Implement inline to preserve full WeeklyPlan type (findWeekPlanForDate returns constraint type only)
  type MacroWeeklyPlan = (typeof currentPhase.weeklyPlans)[number];
  const currentWeekPlan = currentPhase.weeklyPlans.find((w: MacroWeeklyPlan) => {
    const d = todayMs;
    return dayKey(w.startDate).getTime() <= d && d < dayKey(w.endDate).getTime();
  }) ?? null;
  if (!currentWeekPlan) throw new Error("No current week plan");

  const config = currentPhase.config as unknown as PhaseConfig;
  const goalTarget = macro.goal.targetValue as unknown as { time?: string };
  const firstWeekOfBlock = Math.min(
    ...currentPhase.weeklyPlans.map((w: MacroWeeklyPlan) => w.weekNumber),
  );

  return {
    macrocycle: {
      id: macro.id,
      startDate: formatDateStr(macro.startDate),
      endDate: formatDateStr(macro.endDate),
      totalWeeks: macro.totalWeeks,
      currentWeek: currentWeekPlan.weekNumber,
      goalRace: macro.goal.primaryType.replace("_time", ""),
      goalTime: goalTarget.time ?? null,
      status: macro.status,
    },
    block: {
      number: currentPhase.blockNumber,
      name: currentPhase.name,
      weekInBlock: currentWeekPlan.weekNumber - firstWeekOfBlock + 1,
      totalWeeksInBlock: currentPhase.durationWeeks,
    },
    currentProgression: {
      volumeProgression: config.volumeProgression,
      strengthMode: config.strengthMode,
      strengthRpeCap: config.strengthRpeCap,
      vdotTarget: config.vdotTarget,
    },
  };
}

async function buildPerformanceMarkers(userId: string): Promise<PerformanceMarkersSection> {
  const [vdot, settings] = await Promise.all([
    getEffectiveVdot(userId),
    db.userSettings.findUnique({
      where: { userId },
      select: { hrMax: true, hrRest: true, exerciseMaxEstimates: true },
    }),
  ]);

  const hrMax = settings?.hrMax ?? null;
  const hrRest = settings?.hrRest ?? null;
  let zones = null;
  if (hrMax !== null && hrRest !== null) {
    const hrr = hrMax - hrRest;
    zones = {
      z1Ceiling: Math.round(hrRest + 0.75 * hrr),
      z2Ceiling: Math.round(hrRest + 0.87 * hrr),
    };
  }

  return {
    currentVDOT: vdot,
    hrMax,
    hrRest,
    zones,
    oneRMEstimates: (settings?.exerciseMaxEstimates as Record<string, number> | null) ?? {},
  };
}

function mapPlannedSession(json: unknown): PlannedSessionData {
  const s = json as SessionPlan;
  return {
    durationMin: s.durationMin,
    targetHR: s.hrTarget ? { from: s.hrTarget.from, to: s.hrTarget.to } : undefined,
    targetPace: s.paceTarget ? { from: s.paceTarget.from, to: s.paceTarget.to } : undefined,
    exercises: s.exercises?.map((e) => ({
      name: e.name,
      sets: e.sets,
      reps: e.reps,
      loadPct: e.loadPct,
      loadKg: e.loadAbs,
    })),
  };
}

function mapExecutedSession(json: unknown): ActualSessionData | undefined {
  const parsed = ExecutedSessionSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const exec = parsed.data;

  if (exec.type === "run") {
    return {
      durationMin: exec.durationSec / 60,
      distanceKm: exec.distanceM != null ? exec.distanceM / 1000 : undefined,
      avgPaceSecPerKm: exec.averagePaceSecPerKm,
      avgHR: exec.averageHr,
      maxHR: exec.maxHr,
      elevationGainM: exec.elevationGainM,
      calories: exec.calories,
      splits: exec.splits.map((s) => ({
        splitNumber: s.splitNumber,
        distanceM: s.distanceM,
        paceSecPerKm: s.paceSecPerKm,
        avgHR: s.averageHr,
      })),
    };
  }

  // strength
  return {
    durationMin: exec.durationActualMin,
    exercises: exec.exercises.map((e) => ({
      name: e.name,
      skipped: e.skipped,
      sets: e.actualSets.map((s) => ({
        reps: s.reps,
        loadKg: s.loadKg,
        rpe: s.rpe,
        durationSec: s.durationSec,
      })),
    })),
    kneePainNrs: exec.kneePainNrs,
  };
}

async function buildTrainingHistory(userId: string, today: Date): Promise<TrainingHistorySection> {
  const cutoff = new Date(today.getTime() - 28 * 86400000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workouts: any[] = await db.workout.findMany({
    where: { userId, date: { gte: cutoff } },
    orderBy: { date: "asc" },
  });

  let plannedCount = 0;
  let completedCount = 0;
  let skippedCount = 0;

  const runVolByWeek = new Map<string, { planned: number; actual: number }>();
  const strengthByWeek = new Map<string, { totalSets: number; totalTonnageKg: number }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessions: TrainingSession[] = workouts.map((w: any) => {
    if (w.type !== "rest") {
      if (w.status === "completed") completedCount++;
      else if (w.status === "skipped" || w.status === "skipped_illness") skippedCount++;
      else plannedCount++;
    }

    const weekKey = isoWeekKey(w.date);
    const actual = w.executedSession ? mapExecutedSession(w.executedSession) : undefined;

    if (actual?.distanceKm) {
      const entry = runVolByWeek.get(weekKey) ?? { planned: 0, actual: 0 };
      entry.actual += actual.distanceKm;
      runVolByWeek.set(weekKey, entry);
    }

    if (actual?.exercises) {
      let totalSets = 0;
      let totalTonnageKg = 0;
      for (const e of actual.exercises) {
        if (!e.skipped) {
          for (const s of e.sets) {
            totalSets++;
            if (s.loadKg != null) totalTonnageKg += s.loadKg * s.reps;
          }
        }
      }
      const entry = strengthByWeek.get(weekKey) ?? { totalSets: 0, totalTonnageKg: 0 };
      entry.totalSets += totalSets;
      entry.totalTonnageKg += totalTonnageKg;
      strengthByWeek.set(weekKey, entry);
    }

    return {
      date: formatDateStr(w.date),
      dayOfWeek: formatDayOfWeek(w.date),
      type: w.type,
      status: w.status,
      planned: mapPlannedSession(w.plannedSession),
      actual,
      rpe: w.rpe,
      notes: w.notes,
      periodizationLabel: (w.plannedSession as SessionPlan).periodizationLabel,
      modifications: (w.modulations as string[] | null) ?? [],
    };
  });

  const total = completedCount + skippedCount + plannedCount;

  const weeklyRunKm = Array.from(runVolByWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, planned: v.planned, actual: Math.round(v.actual * 10) / 10 }));

  const weeklyStrengthSets = Array.from(strengthByWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({
      week,
      totalSets: v.totalSets,
      totalTonnageKg: Math.round(v.totalTonnageKg),
    }));

  return {
    last28Days: {
      planned: plannedCount,
      completed: completedCount,
      skipped: skippedCount,
      complianceRate: computeComplianceRate(completedCount, total),
    },
    sessions,
    volumeTrends: { weeklyRunKm, weeklyStrengthSets },
  };
}

async function buildWellness(userId: string): Promise<WellnessSection> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await getRecentSensorData(userId, 28);

  const cutoff14 = dayKey(new Date());
  cutoff14.setUTCDate(cutoff14.getUTCDate() - 14);

  // Sprint v0.16 fix: rest of the codebase writes camelCase keys (see
  // app/api/cron/garmin-sync-daily). The v0.12.1 implementation read
  // snake_case which silently returned null for every field.
  type GarminBlob = {
    hrvStatus?: string;
    hrvRmssd?: number;
    sleepScore?: number;
    sleepDurationMin?: number;
    bodyBatteryMorning?: number;
    rhr?: number;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentRows = rows.filter((r: any) => r.date.getTime() >= cutoff14.getTime());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const days: WellnessDay[] = recentRows.map((r: any) => {
    const g = (r.garmin ?? {}) as GarminBlob;
    return {
      date: formatDateStr(r.date),
      restingHR: g.rhr ?? null,
      hrvRMSSD: g.hrvRmssd ?? null,
      hrvStatus: g.hrvStatus ?? null,
      sleepScore: g.sleepScore ?? null,
      sleepDurationMin: g.sleepDurationMin ?? null,
      bodyBatteryMorning: g.bodyBatteryMorning ?? null,
      bodyBatteryEnd: r.bodyBatteryEnd ?? null,
      averageStress: r.averageStress ?? null,
      readinessScore: r.readinessScore ?? null,
      readinessBand: r.readinessBand ?? null,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rhrVals = rows.map((r: any) => (r.garmin as GarminBlob | null)?.rhr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hrvVals = rows.map((r: any) => (r.garmin as GarminBlob | null)?.hrvRmssd);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sleepVals = rows.map((r: any) => (r.garmin as GarminBlob | null)?.sleepScore);

  const baselines: WellnessBaselines | null =
    rows.length === 0
      ? null
      : {
          restingHR28dAvg: nullAvg(rhrVals),
          hrvRMSSD28dAvg: nullAvg(hrvVals),
          sleepScore28dAvg: nullAvg(sleepVals),
        };

  return { days, baselines };
}

async function buildHealth(userId: string, today: Date): Promise<HealthSection> {
  const cutoff = new Date(today.getTime() - 90 * 86400000);

  const [settings, latestSensor, activeGoal, painWorkouts] = await Promise.all([
    db.userSettings.findUnique({
      where: { userId },
      select: {
        therapyPhaseOverride: true,
        activeInjuries: true,
        preventionExercises: true,
      },
    }),
    db.dailySensorData.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
      select: { therapyPhase: true },
    }),
    db.goal.findFirst({
      where: { userId, status: "active" },
      orderBy: { createdAt: "desc" },
      select: { constraints: true },
    }),
    db.workout.findMany({
      where: { userId, date: { gte: cutoff } },
      orderBy: { date: "asc" },
      select: { date: true, type: true, executedSession: true },
    }),
  ]);

  const therapyPhase =
    settings?.therapyPhaseOverride ?? latestSensor?.therapyPhase ?? null;

  // Sprint v0.16 Phase A1 added userSettings.activeInjuries — the AI coach
  // maintains it via /api/coaching-update. Falls back to Goal.constraints
  // for legacy data when UserSettings hasn't been populated yet.
  const settingsInjuries = (settings?.activeInjuries ?? []) as string[];
  const activeInjuries =
    settingsInjuries.length > 0
      ? settingsInjuries
      : (
          (activeGoal?.constraints as { type: string; severity: string }[] | null) ?? []
        )
          .filter((c) => c.severity === "active")
          .map((c) => c.type);

  const preventionExercises = (settings?.preventionExercises ?? []) as string[];

  const painHistory: PainEntry[] = [];
  for (const w of painWorkouts) {
    if (!w.executedSession) continue;
    const parsed = ExecutedSessionSchema.safeParse(w.executedSession);
    if (!parsed.success) continue;
    const exec = parsed.data;
    if (exec.type === "strength" && exec.kneePainNrs != null) {
      painHistory.push({
        date: formatDateStr(w.date),
        exercise: w.type,
        painNRS: exec.kneePainNrs,
      });
    }
  }

  return { therapyPhase, activeInjuries, painHistory, preventionExercises };
}

// ── Calories (Sprint v0.16 Phase A2.5) ─────────────────────────────────────
// Day-type mapping lives in lib/nutrition/day-type.ts (single source of truth).

async function buildCalories(userId: string): Promise<CaloriesSection> {
  const cutoff14 = dayKey(new Date());
  cutoff14.setUTCDate(cutoff14.getUTCDate() - 14);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await db.dailySensorData.findMany({
    where: { userId, date: { gte: cutoff14 } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      totalKilocalories: true,
      activeKilocalories: true,
      bmrKilocalories: true,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const days: CalorieDay[] = rows.map((r: any) => ({
    date: formatDateStr(r.date),
    totalKcal: r.totalKilocalories ?? null,
    activeKcal: r.activeKilocalories ?? null,
    bmrKcal: r.bmrKilocalories ?? null,
  }));

  const buckets = { strength_run: [] as number[], threshold: [] as number[], long_run: [] as number[], rest: [] as number[] };
  for (const r of rows) {
    if (r.totalKilocalories == null) continue;
    const dayType = DAY_TYPE_BY_WEEKDAY[(r.date as Date).getUTCDay()];
    buckets[dayType].push(r.totalKilocalories);
  }

  const avg = (vals: number[]): number | null =>
    vals.length === 0 ? null : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  return {
    days,
    averageByDayType: {
      strength_run: avg(buckets.strength_run),
      threshold: avg(buckets.threshold),
      long_run: avg(buckets.long_run),
      rest: avg(buckets.rest),
    },
  };
}

async function buildUpcoming(userId: string, today: Date): Promise<UpcomingSection> {
  const todayMs = dayKey(today).getTime();
  const endMs = todayMs + 7 * 86400000;

  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: {
      phases: {
        include: { weeklyPlans: true },
        orderBy: { blockNumber: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!macro) return DEFAULT_UPCOMING;

  const sessions: UpcomingSession[] = [];

  for (const phase of macro.phases) {
    for (const weekPlan of phase.weeklyPlans) {
      if (!Array.isArray(weekPlan.plannedSessions)) continue;
      for (const raw of weekPlan.plannedSessions as unknown as SessionPlan[]) {
        if (!raw?.date) continue;
        const sessionMs = dayKey(new Date(raw.date)).getTime();
        if (sessionMs >= todayMs && sessionMs < endMs) {
          const sessionDate = new Date(raw.date);
          sessions.push({
            date: formatDateStr(sessionDate),
            dayOfWeek: formatDayOfWeek(sessionDate),
            type: raw.type,
            planned: {
              durationMin: raw.durationMin,
              targetHR: raw.hrTarget ? { from: raw.hrTarget.from, to: raw.hrTarget.to } : undefined,
              exercises: raw.exercises?.map((e) => ({
                name: e.name,
                sets: e.sets,
                reps: e.reps,
                loadPct: e.loadPct,
              })),
            },
            periodizationLabel: raw.periodizationLabel,
          });
        }
      }
    }
  }

  sessions.sort((a, b) => a.date.localeCompare(b.date));
  return { sessions };
}

async function buildAthlete(userId: string): Promise<AthleteSection> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: {
      currentWeightKg: true,
      targetWeightKg: true,
      forcedRestDays: true,
      preferredLongRunDay: true,
      timezone: true,
      therapyPhaseOverride: true,
    },
  });

  const isoDayName = (d: number) => ISO_DAY_NAMES[(d - 1) % 7] ?? `Day ${d}`;

  return {
    weightKg: settings?.currentWeightKg ?? null,
    targetWeightKg: settings?.targetWeightKg ?? null,
    timezone: settings?.timezone ?? null,
    restDays: (settings?.forcedRestDays ?? []).map(isoDayName),
    preferredLongRunDay: isoDayName(settings?.preferredLongRunDay ?? 6),
    therapyPhase: settings?.therapyPhaseOverride ?? null,
  };
}

// ── Nutrition (Sprint v0.16 Phase B8) ─────────────────────────────────────

async function buildNutrition(userId: string, today: Date): Promise<NutritionSection> {
  const todayKey = dayKey(today);
  const dayType = getDayType(today);
  const cutoff7 = new Date(todayKey.getTime() - 7 * 86400000);

  const [plan, todayLog, recentLogs] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.mealPlan.findFirst({
      where: { userId, status: "active" },
      include: { dayPlans: true },
    }) as Promise<any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.dailyNutritionLog.findUnique({
      where: { userId_date: { userId, date: todayKey } },
    }) as Promise<any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.dailyNutritionLog.findMany({
      where: { userId, date: { gte: cutoff7 } },
      orderBy: { date: "asc" },
    }) as Promise<any[]>,
  ]);

  let activePlan: NutritionSection["activePlan"] = null;
  let todayPlan: NutritionSection["todayPlan"] = null;
  let weeklyBudget: NutritionSection["weeklyBudget"] = null;

  if (plan) {
    activePlan = {
      name: plan.name,
      calibrationStatus: plan.calibrationStatus,
      calibratedAt: plan.calibratedAt ? plan.calibratedAt.toISOString() : null,
    };
    weeklyBudget = {
      planned: Math.round(plan.budgetPerDay * 7 * 100) / 100,
      perDay: plan.budgetPerDay,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const todayDayPlan = (plan.dayPlans ?? []).find((d: any) => d.dayType === dayType);
    if (todayDayPlan) {
      todayPlan = {
        dayType,
        calorieTarget: todayDayPlan.calorieTarget,
        proteinG: todayDayPlan.proteinG,
        carbsG: todayDayPlan.carbsG,
        fatG: todayDayPlan.fatG,
        slots: todayDayPlan.slots,
        adjustment: (todayLog?.adjustment as unknown) ?? null,
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const last7DaysLog: NutritionDayLog[] = recentLogs.map((l: any) => {
    const adj = l.adjustment as DailyAdjustment | null;
    const delta =
      l.garminTDEE != null && typeof l.calorieTarget === "number"
        ? l.calorieTarget - (l.garminTDEE - DEFICIT_KCAL)
        : null;
    return {
      date: l.date.toISOString().slice(0, 10),
      dayType: l.dayType,
      calorieTarget: l.calorieTarget,
      garminTDEE: l.garminTDEE ?? null,
      delta,
      adjustment: adj?.message ?? null,
      followed: l.followed,
      notes: l.notes ?? null,
    };
  });

  // v1.1: Load DayTypeConfigs + ComputedMealSlots from DB
  let dayTypeConfigs: NutritionSection["dayTypeConfigs"];
  let recipeTemplatesSummary: NutritionSection["recipeTemplates"];
  let computedPlans: NutritionSection["computedPlans"];

  if (plan) {
    const [dbConfigs, dbSlots] = await Promise.all([
      db.dayTypeConfig.findMany({ where: { planId: plan.id } }),
      db.computedMealSlot.findMany({ where: { planId: plan.id } }),
    ]);

    if (dbConfigs.length > 0) {
      dayTypeConfigs = dbConfigs.map((c) => ({
        dayType: c.dayType,
        calorieTarget: c.calorieTarget,
        proteinG: c.proteinG,
        carbsG: c.carbsG,
        fatG: c.fatG,
        mainMealRecipeId: c.mainMealRecipeId,
        mainMealRatio: c.mainMealRatio,
        dinnerRecipeId: c.dinnerRecipeId,
        dinnerRatio: c.dinnerRatio,
        flexDessertEnabled: c.flexDessertEnabled,
      }));

      recipeTemplatesSummary = RECIPE_TEMPLATES.map((r) => ({ id: r.id, name: r.name }));
    }

    if (dbSlots.length > 0) {
      const byDayType: Record<string, typeof dbSlots> = {};
      for (const slot of dbSlots) {
        (byDayType[slot.dayType] ??= []).push(slot);
      }

      computedPlans = {};
      for (const [dt, slots] of Object.entries(byDayType)) {
        const slotsMap: Record<string, unknown> = {};
        let kcal = 0, protein = 0, carbs = 0, fat = 0, cost = 0;
        for (const s of slots) {
          slotsMap[s.slotName] = {
            recipeId: s.recipeId,
            recipeName: s.recipeName,
            items: s.items,
            totalKcal: s.totalKcal,
            totalProtein: s.totalProtein,
          };
          kcal += s.totalKcal;
          protein += s.totalProtein;
          carbs += s.totalCarbs;
          fat += s.totalFat;
          cost += s.totalCost;
        }
        computedPlans[dt] = {
          slots: slotsMap,
          totals: {
            kcal: Math.round(kcal),
            protein: Math.round(protein),
            carbs: Math.round(carbs),
            fat: Math.round(fat),
            cost: Math.round(cost * 100) / 100,
          },
        };
      }
    }

    // v1.1 fix: Prefer ComputedMealSlots + DayTypeConfig for todayPlan
    // (same data source as the UI's /api/nutrition/today route)
    if (computedPlans?.[dayType] && dayTypeConfigs) {
      const todayConfig = dayTypeConfigs.find((c) => c.dayType === dayType);
      if (todayConfig) {
        todayPlan = {
          dayType,
          calorieTarget: todayConfig.calorieTarget,
          proteinG: todayConfig.proteinG,
          carbsG: todayConfig.carbsG,
          fatG: todayConfig.fatG,
          slots: computedPlans[dayType].slots,
          adjustment: (todayLog?.adjustment as unknown) ?? null,
        };
      }
    }
  }

  return {
    activePlan,
    todayPlan,
    last7DaysLog,
    weeklyBudget,
    dayTypeConfigs,
    recipeTemplates: recipeTemplatesSummary,
    computedPlans,
  };
}

// ── Main export ──────────────────────────────────────────────────────────

export async function buildCoachingExport(userId: string): Promise<CoachingExport> {
  const today = await userTodayDynamic();

  const [periodization, performanceMarkers, trainingHistory, wellness, calories, health, upcoming, athlete, nutrition] =
    await Promise.all([
      safeSection(() => buildPeriodization(userId, today)),
      safeSection(() => buildPerformanceMarkers(userId)),
      safeSection(() => buildTrainingHistory(userId, today), DEFAULT_TRAINING_HISTORY),
      safeSection(() => buildWellness(userId), DEFAULT_WELLNESS),
      safeSection(() => buildCalories(userId), DEFAULT_CALORIES),
      safeSection(() => buildHealth(userId, today), DEFAULT_HEALTH),
      safeSection(() => buildUpcoming(userId, today), DEFAULT_UPCOMING),
      safeSection(() => buildAthlete(userId), DEFAULT_ATHLETE),
      safeSection(() => buildNutrition(userId, today)),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    periodization,
    performanceMarkers,
    trainingHistory,
    wellness,
    calories,
    health,
    upcoming,
    athlete,
    nutrition,
  };
}
