// Free-chat system prompt + intent-aware context expansion.
// See spec §10.5 (Smart Context Window).
//
// Pattern:
//   1. Frozen system prompt (cacheable)  — sets tone, scope, rules
//   2. Always: user-profile summary       — goal, current phase, 7d trends
//   3. On-demand: knee/perf/block/recovery context based on intent regex
//   4. Last N messages of the conversation
//   5. New user message
//
// We keep all "always" content (system + profile) inside the cached prefix and
// append intent-specific context AFTER it. That way the cache hits across
// conversations even when topics drift.

import type Anthropic from "@anthropic-ai/sdk";

export const FREE_CHAT_SYSTEM_PROMPT = `Du bist der AI-Coach von Project Ares, einer wissenschaftlich fundierten Hybrid-Training-App für einen einzelnen Athleten.

DEINE ROLLE:
- Du bist der Sparring-Partner für Q's Trainingsfragen, Reflexion, und Verständnis seiner Daten.
- Du erfindest KEINE Trainings-Empfehlungen. Die deterministische Coach-Engine entscheidet — du erklärst, kontextualisierst, hilfst beim Verstehen.

REGELN:
1. Verweise auf konkrete Sensor-Daten und Engine-Outputs wenn relevant. Wenn du Daten nicht hast, sage es.
2. Bei medizinischen Themen (Schmerz, Verletzung, Symptome) verweise auf Sportarzt/Physio. Du diagnostizierst nicht.
3. Tone: kompetent, präzise, auf Augenhöhe. Kein Coach-Sprech, keine Floskeln, keine Emojis.
4. Antworte auf Deutsch.
5. Standard-Länge: 3-6 Sätze. Längere Antworten nur wenn die Frage es verlangt (z.B. detaillierte Trainings-Wissensfrage).
6. Du darfst zugeben, dass du etwas nicht weißt. Du darfst sagen "die Engine hat das so entschieden, weil <Regel>" und auf science_doc verweisen wenn nötig.

SKALEN — IMMER User-facing einheiten verwenden, NIEMALS Engine-internal Component-Scores:
- Knie: "X/10" (1=schmerzfrei, 10=stark) — niemals "Knee 80" oder Component-Score
- HRV: "X ms" RMSSD — niemals "HRV-Score 80"
- Sleep: "X/100" Garmin-Score
- RHR: "X bpm"
- Subjective: "X/10"

KONTEXT-FORMAT:
Du erhältst vor jedem Chat:
- User-Profil (Goal, Block, VDOT, Trend)
- Aktueller Workout-Plan: heutige Sessions (modulated wenn morning-input vorliegt), kommende 7 Tage geplant, letzte 5 abgeschlossene mit RPE und Modulationen
- Optional: Detail-Daten zu Knie/Recovery wenn die Frage es betrifft

REGELN ZUM WORKOUT-PLAN:
- Du kannst Q über aktuelle/geplante/vergangene Übungen Auskunft geben. Du kennst seinen Plan.
- Du erfindest keine neuen Workouts. Wenn der Plan etwas nicht enthält, sage das ehrlich ("der Plan listet diese Session/Übung nicht").
- Bei Strength: nenne konkrete Übungen, Sets, Reps, Tempo, Pausen wenn gefragt. Die Werte stehen im Kontext-Block.
- Bei Run: Pace-Target, Zone, RPE-Ziel.
- Wenn Modulationen aktiv waren/sind: erkläre welche und warum (deterministische Engine-Logik).
- Supersets (seit v0.7): wenn zwei Übungen die gleiche supersetGroup haben (z.B. "A1"), werden sie als Paar performt — erst supersetOrder=1, direkt danach supersetOrder=2 (0–15s Pause). Volle Pause (restSec) erst NACH dem Paar. Die Begründung steht in supersetRationale. HSR-Lifts (Hex Bar Deadlift, RDL) sind NIEMALS in Supersets — Tendon-Loading braucht volle 3min-Pause (Kongsgaard 2009). Block 1 (Aerobic Base) und Block 5 (Peaking) haben aktuell ausschließlich Straight Sets. Block 2-4 nutzen Antagonist-Pairs für Accessories. Wenn der Kontext Supersets zeigt: korrekt erklären; wenn nicht: sagen "diese Session ist Straight-Sets only".
- Wenn der Workout-Context-Block unten fehlt oder leer ist: sage ehrlich "Plan-Daten fehlen aktuell" — niemals erfinden.`;

const KNEE_RE = /\b(knie|knee|tendon|sehne|patellatendinitis|patellatendinopathie|schmerz|stairs|treppen)\b/i;
const PERF_RE = /\b(5k|10k|pace|geschwindigkeit|time trial|wettkampf|leistung|tempo|vdot)\b/i;
const BLOCK_RE = /\b(block|phase|woche|periodisierung|plan|macrocycle)\b/i;
const RECOVERY_RE = /\b(recovery|erholung|hrv|sleep|schlaf|m[üu]digkeit|fatigue|readiness|ruhepuls|rhr)\b/i;

export interface IntentFlags {
  knee: boolean;
  performance: boolean;
  block: boolean;
  recovery: boolean;
}

export function detectIntent(message: string): IntentFlags {
  return {
    knee: KNEE_RE.test(message),
    performance: PERF_RE.test(message),
    block: BLOCK_RE.test(message),
    recovery: RECOVERY_RE.test(message),
  };
}

export interface FreeChatProfile {
  goalSummary: string;
  currentBlock: string;
  weekNumber: number;
  vdotInitial: number;
  recentTrend: string;
  activeConstraints: string[];
}

export function formatProfileSummary(p: FreeChatProfile): string {
  return `User-Profil:
- Goal: ${p.goalSummary}
- Aktueller Block: ${p.currentBlock} (Woche ${p.weekNumber})
- VDOT initial: ${p.vdotInitial}
- 7d-Trend: ${p.recentTrend}
- Aktive Constraints: ${p.activeConstraints.length > 0 ? p.activeConstraints.join(", ") : "keine"}`;
}

export interface KneeHistoryEntry {
  date: string;
  morningStiffness: number;
  stairsScore: number;
  postSession?: number;
}
export function formatKneeHistory(history: KneeHistoryEntry[]): string {
  if (history.length === 0) return "Keine Knie-Historie verfügbar.";
  const lines = history.map(
    (h) =>
      `${h.date}: Stiffness ${h.morningStiffness}/10, Stairs ${h.stairsScore}/10` +
      (h.postSession !== undefined ? `, Post-Session ${h.postSession}/10` : ""),
  );
  return `Knee-Historie (letzte ${history.length} Tage):\n${lines.join("\n")}`;
}

export interface RecoveryTrendEntry {
  date: string;
  hrv: number | null;
  sleepScore: number | null;
  readinessScore: number | null;
  rhr: number | null;
}
export function formatRecoveryTrend(entries: RecoveryTrendEntry[]): string {
  if (entries.length === 0) return "Keine Recovery-Historie.";
  const lines = entries.map(
    (e) =>
      `${e.date}: HRV ${e.hrv ?? "—"} ms, Sleep ${e.sleepScore ?? "—"}, RHR ${e.rhr ?? "—"}, Readiness ${e.readinessScore ?? "—"}`,
  );
  return `Recovery-Trend (${entries.length} Tage):\n${lines.join("\n")}`;
}

export interface BlockStatus {
  blockNumber: number;
  phaseName: string;
  startDate: string;
  endDate: string;
  averageReadiness: number | null;
  averageACWR: number | null;
}
export function formatBlockStatus(s: BlockStatus): string {
  return `Aktueller Block: ${s.blockNumber} (${s.phaseName}), ${s.startDate} → ${s.endDate}.
Block-Avg Readiness: ${s.averageReadiness ?? "—"}, Avg ACWR: ${s.averageACWR ?? "—"}.`;
}

/**
 * Build the messages array for an Anthropic call.
 * `priorMessages` is the existing conversation (excludes the new user msg).
 * `newUserMessage` is what the user just typed.
 * `workoutContext` is always-on plan info (today + upcoming + recent + block).
 * `contextBlocks` are intent-driven detail blocks (knee history, recovery trend, etc.).
 */
export interface BuildFreeChatRequest {
  profile: FreeChatProfile;
  priorMessages: { role: "user" | "assistant"; content: string }[];
  newUserMessage: string;
  /** Always-on workout-plan context, formatted by formatWorkoutContext(). */
  workoutContext?: string | null;
  /** Intent-derived detail context (knee history, recovery trend, …). */
  contextBlocks: string[];
}

export function buildFreeChatMessages(
  req: BuildFreeChatRequest,
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  // 1. Combined context block (profile + workout + intent-driven detail).
  //    Sent as a "user" message tagged [KONTEXT] so Claude treats it as
  //    background and not a question to answer.
  const blocks: string[] = [formatProfileSummary(req.profile)];
  if (req.workoutContext) blocks.push(req.workoutContext);
  for (const c of req.contextBlocks) if (c) blocks.push(c);

  result.push({
    role: "user",
    content: `[KONTEXT — nicht beantworten, nur als Hintergrund nutzen]\n\n${blocks.join("\n\n")}`,
  });
  result.push({ role: "assistant", content: "Verstanden. Womit kann ich helfen?" });

  // 2. Last 10 prior messages
  const recent = req.priorMessages.slice(-10);
  for (const m of recent) {
    result.push({ role: m.role, content: m.content });
  }

  // 3. New user message
  result.push({ role: "user", content: req.newUserMessage });

  return result;
}
