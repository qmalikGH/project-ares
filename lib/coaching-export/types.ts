// Types for /api/coaching-export — adapted to actual Prisma schema.
// Nullable / optional fields reflect what may or may not be in DB.

export interface CoachingExport {
  exportedAt: string;
  periodization: PeriodizationSection | null;
  performanceMarkers: PerformanceMarkersSection | null;
  trainingHistory: TrainingHistorySection;
  wellness: WellnessSection;
  health: HealthSection;
  upcoming: UpcomingSection;
  athlete: AthleteSection;
}

// ── Periodization ──────────────────────────────────────────────────────────

export interface PeriodizationSection {
  macrocycle: {
    id: string;
    startDate: string;
    endDate: string;
    totalWeeks: number;
    currentWeek: number;
    goalRace: string;
    goalTime: string | null;
    status: string;
  };
  block: {
    number: number;
    name: string;
    weekInBlock: number;
    totalWeeksInBlock: number;
  };
  currentProgression: {
    volumeProgression: string;
    strengthMode: string;
    strengthRpeCap: number;
    vdotTarget: number;
  };
}

// ── Performance Markers ────────────────────────────────────────────────────

export interface HRZones {
  z1Ceiling: number;
  z2Ceiling: number;
}

export interface PerformanceMarkersSection {
  currentVDOT: number;
  hrMax: number | null;
  hrRest: number | null;
  zones: HRZones | null;
  oneRMEstimates: Record<string, number>;
}

// ── Training History ───────────────────────────────────────────────────────

export interface PlannedExercise {
  name: string;
  sets: number;
  reps: number | string;
  loadPct?: number;
  loadKg?: number;
}

export interface PlannedSessionData {
  durationMin?: number;
  targetHR?: { from: number; to: number };
  targetPace?: { from: string; to: string };
  exercises?: PlannedExercise[];
}

export interface ActualSet {
  reps: number;
  loadKg: number | null;
  rpe: number | null;
  durationSec: number | null;
}

export interface ActualExercise {
  name: string;
  skipped: boolean;
  sets: ActualSet[];
}

export interface SplitData {
  splitNumber: number;
  distanceM: number;
  paceSecPerKm: number | null;
  avgHR: number | null;
}

export interface ActualSessionData {
  durationMin?: number;
  distanceKm?: number;
  avgPaceSecPerKm?: number | null;
  avgHR?: number | null;
  maxHR?: number | null;
  elevationGainM?: number | null;
  calories?: number | null;
  splits?: SplitData[];
  exercises?: ActualExercise[];
  kneePainNrs?: number;
}

export interface TrainingSession {
  date: string;
  dayOfWeek: string;
  type: string;
  status: string;
  planned: PlannedSessionData;
  actual?: ActualSessionData;
  rpe?: number | null;
  notes?: string | null;
  periodizationLabel?: string;
  modifications: string[];
}

export interface ComplianceSummary {
  planned: number;
  completed: number;
  skipped: number;
  complianceRate: number;
}

export interface WeeklyRunVolume {
  week: string;
  planned: number;
  actual: number;
}

export interface WeeklyStrengthVolume {
  week: string;
  totalSets: number;
  totalTonnageKg: number;
}

export interface VolumeTrends {
  weeklyRunKm: WeeklyRunVolume[];
  weeklyStrengthSets: WeeklyStrengthVolume[];
}

export interface TrainingHistorySection {
  last28Days: ComplianceSummary;
  sessions: TrainingSession[];
  volumeTrends: VolumeTrends;
}

// ── Wellness ───────────────────────────────────────────────────────────────

export interface WellnessDay {
  date: string;
  restingHR: number | null;
  hrvRMSSD: number | null;
  hrvStatus: string | null;
  sleepScore: number | null;
  sleepDurationMin: number | null;
  bodyBatteryMorning: number | null;
  readinessScore: number | null;
  readinessBand: string | null;
}

export interface WellnessBaselines {
  restingHR28dAvg: number | null;
  hrvRMSSD28dAvg: number | null;
  sleepScore28dAvg: number | null;
}

export interface WellnessSection {
  days: WellnessDay[];
  baselines: WellnessBaselines | null;
}

// ── Health ─────────────────────────────────────────────────────────────────

export interface PainEntry {
  date: string;
  exercise: string;
  painNRS: number;
}

export interface HealthSection {
  therapyPhase: string | null;
  activeInjuries: string[];
  painHistory: PainEntry[];
  preventionExercises: string[];
}

// ── Upcoming ───────────────────────────────────────────────────────────────

export interface UpcomingSession {
  date: string;
  dayOfWeek: string;
  type: string;
  planned: PlannedSessionData;
  periodizationLabel?: string;
}

export interface UpcomingSection {
  sessions: UpcomingSession[];
}

// ── Athlete ────────────────────────────────────────────────────────────────

export interface AthleteSection {
  weightKg: number | null;
  targetWeightKg: number | null;
  timezone: string | null;
  restDays: string[];
  preferredLongRunDay: string;
  therapyPhase: string | null;
}
