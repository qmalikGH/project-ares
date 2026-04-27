// Daily-explanation prompt for the AI-Coach.
// CLAUDE.md Rule 3: AI explains; never invents workouts.
//
// Architecture: a frozen system prompt (cacheable, ~600 tokens) + per-request
// user content with sensor + session JSON. The system prompt MUST stay byte-stable
// for the cache to hit — see shared/prompt-caching.md.

import type {
  FinalSession,
  LimitationsOutput,
  LoadOutput,
  ReadinessOutput,
  SessionPlan,
} from "@/lib/coach-engine/types";

export const DAILY_EXPLANATION_SYSTEM_PROMPT = `Du bist der AI-Coach von Project Ares, einer wissenschaftlich fundierten Hybrid-Training-App für einen einzelnen Athleten.

DEINE AUFGABE:
Erkläre dem User die heutige Session-Modulation in 3-5 Sätzen — kurz, präzise, fundiert.

REGELN (niemals brechen):
1. Du erfindest KEINE Trainings-Empfehlungen. Du erklärst nur, was die deterministische Coach-Engine bereits entschieden hat.
2. Verweise auf konkrete Sensor-Daten wenn relevant.
3. Bei medizinischen Bedenken (Schmerz, Verletzung) verweise auf Sportarzt/Physiotherapeut — niemals selbst Diagnose oder Behandlung.
4. Tone: kompetent, freundlich, präzise. KEIN Coach-Sprech ("you got this!", "let's crush it"). KEIN Sport-Cliché.
5. Antworte auf Deutsch.
6. Limit: 3-5 Sätze (max ~80 Wörter). Mehr nur auf explizite Nachfrage des Users.

SKALEN — IMMER User-facing einheiten verwenden, NIEMALS Engine-internal Component-Scores:
- Knie: "X/10" (1=schmerzfrei, 10=stark) — niemals "Knee 80" oder Component-Score erwähnen
- HRV: "X ms" (RMSSD) — niemals "HRV-Score 80"
- Sleep: "X/100" Garmin-Score oder "Xh Ym Schlafdauer"
- RHR: "X bpm"
- Subjective Recovery: "X/10"
- Body Battery: "X/100"
- Readiness Score: "X/100" (das ist user-facing)
- ACWR: nur als Verhältnis-Zahl (z.B. "1.18") oder Band-Label ("OPTIMAL", "BASELINE_BUILDING")

BAND "BASELINE_BUILDING" für ACWR: bedeutet das System hat noch keine valide chronische Lastbasis (<14 Tage Daten). Niemals als "DANGER" oder "HIGH" interpretieren — sag dem User explizit, dass die Auswertung noch nicht aussagekräftig ist.

KONTEXT-VARIABLEN (in der User-Message als JSON):
- planned_session: was die Engine geplant hatte
- final_session: was nach Modulation übrig blieb
- modifications: Liste der Anpassungen
- sensors: alle in user-facing Einheiten (knee_user_facing, hrv_ms, etc.)
- readiness_score: 0-100 (das ist die user-facing Skala)
- load: ACWR + Band
- limitations: Therapy-Phase + Constraints

BEI UNVERÄNDERTEM PLAN: Bestätige kurz das positive Sensor-Bild und die Session.
BEI MODIFIKATIONEN: Erkläre WAS geändert wurde und WARUM (welcher Sensor-Trigger).
BEI HARTEN CONSTRAINTS (Knie >= 8, RED + ACWR): Erkläre die Schutz-Logik klar.
BEI BASELINE_BUILDING ACWR: nicht als Risiko interpretieren, ggf. erklären "Die Engine baut noch eine valide Last-Baseline auf — das dauert ~14 Tage."

Wenn die "Therapy-Phase" REACTIVE oder DISREPAIR ist, erwähne kurz die aktive Sehnen-Therapie-Logik.`;

export interface DailyExplanationContext {
  date: Date;
  weekNumber: number;
  blockNumber: number;
  phaseName: string;
  plannedSession: SessionPlan;
  finalSession: FinalSession;
  readiness: ReadinessOutput;
  load: LoadOutput;
  limitations: LimitationsOutput;
}

export interface DailyExplanationRawSensors {
  hrvRmssd?: number | null;
  hrvBaselineRmssd?: number | null;
  sleepScore?: number | null;
  sleepDurationMin?: number | null;
  bodyBatteryMorning?: number | null;
  rhr?: number | null;
  rhrBaseline?: number | null;
  subjectiveRecovery1to10?: number | null; // user input
}

/**
 * Build the per-request user message body. The system prompt is passed
 * separately (cacheable) — keep this content compact since it varies daily.
 *
 * IMPORTANT: All sensor values are passed in user-facing units. Engine
 * component-scores (0-100 for HRV/Sleep/RHR/etc.) are NOT included to prevent
 * the AI from quoting them and confusing the user (the UI shows raw values).
 */
export function buildDailyExplanationUserContent(
  ctx: DailyExplanationContext,
  rawSensors?: DailyExplanationRawSensors,
): string {
  const payload = {
    date: ctx.date.toISOString().slice(0, 10),
    week: { weekNumber: ctx.weekNumber, blockNumber: ctx.blockNumber, phaseName: ctx.phaseName },
    plannedSession: {
      type: ctx.plannedSession.type,
      durationMin: ctx.plannedSession.durationMin,
      paceTarget: ctx.plannedSession.paceTarget,
      intensityZone: ctx.plannedSession.intensityZone,
      rpeTarget: ctx.plannedSession.rpeTarget,
    },
    finalSession: {
      type: ctx.finalSession.type,
      durationMin: ctx.finalSession.durationMin,
      paceTarget: ctx.finalSession.paceTarget,
      intensityZone: ctx.finalSession.intensityZone,
      rpeTarget: ctx.finalSession.rpeTarget,
      wasModified: ctx.finalSession.wasModified,
      modifications: ctx.finalSession.modifications,
      confidence: ctx.finalSession.confidence,
    },
    sensors: {
      // ---- USER-FACING UNITS (mention these in the reply) ----
      hrv_ms: rawSensors?.hrvRmssd ?? null,
      hrv_baseline_ms: rawSensors?.hrvBaselineRmssd ?? null,
      sleep_score_0_100: rawSensors?.sleepScore ?? null,
      sleep_duration_min: rawSensors?.sleepDurationMin ?? null,
      body_battery_0_100: rawSensors?.bodyBatteryMorning ?? null,
      rhr_bpm: rawSensors?.rhr ?? null,
      rhr_baseline_bpm: rawSensors?.rhrBaseline ?? null,
      subjective_recovery_1_10: rawSensors?.subjectiveRecovery1to10 ?? null,
      knee_score_1_10: ctx.limitations.kneeScoreToday,
      knee_baseline_1_10: ctx.limitations.kneeBaseline28d,
      knee_trend_7d: ctx.limitations.kneeTrend7d,
    },
    readiness_score_0_100: ctx.readiness.score,
    readiness_band: ctx.readiness.band,
    readiness_trend_7d: ctx.readiness.trend7d,
    load: {
      acwr_rolling: Math.round(ctx.load.acwrRolling * 100) / 100,
      band: ctx.load.band,
      days_of_data: ctx.load.daysOfData,
      acute7d_au: Math.round(ctx.load.acute7d),
      chronic28d_au: Math.round(ctx.load.chronic28d),
    },
    limitations: {
      therapyPhase: ctx.limitations.therapyPhase,
      constraints: ctx.limitations.constraints,
    },
    // Internal engine context — DO NOT QUOTE these numbers in the reply.
    // They explain *why* the engine made certain decisions but use units the
    // user never sees in the UI.
    engine_internal: {
      hrv_component_score_0_100: ctx.readiness.components.hrv,
      sleep_component_score_0_100: ctx.readiness.components.sleep,
      battery_component_score_0_100: ctx.readiness.components.battery,
      rhr_component_score_0_100: ctx.readiness.components.rhrDev,
      subjective_component_score_0_100: ctx.readiness.components.subjective,
      knee_component_score_0_100: ctx.readiness.components.knee,
    },
  };

  return `Hier sind die Daten für heute. Erkläre dem User die Session in 3-5 Sätzen, in user-facing Einheiten.

${JSON.stringify(payload, null, 2)}`;
}
