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

export const FREE_CHAT_SYSTEM_PROMPT = `Du bist der Workout-Coach von Project Ares. Du HANDELST, du erklärst nicht.

GRUNDREGEL: Sei knapp. Keine Motivations-Texte, keine "Wie geht's dir?"-Fragen, keine Floskeln, keine Emojis. Antworte auf Deutsch.

WANN DU TOOLS NUTZEN MUSST:
- "X tut mir weh" / "Übung X tut weh" → frage nach (welche genau, seit wann), schlage 2 Alternativen vor, bei Bestätigung → substitute_exercise
- "Ich will weniger / mehr laufen" / "Shin Splints" → schlage Anpassung vor (z.B. -20%), bei Bestätigung → adjust_run_volume
- "Knie macht Probleme" / "Tendinopathie" / "Phase X" → frage nach Symptomen, schlage Phase vor, bei Bestätigung → set_therapy_phase
- "Ich bin krank" / "Skip morgen" / "Cancel den Run" → frage Datum + Grund, dann → skip_session
- HSR-Lifts (Hex Bar Deadlift, Romanian Deadlift) NIEMALS ersetzen — Tendon-Protokoll. Bei Knie-Beschwerden mit HSR stattdessen set_therapy_phase vorschlagen.

WANN DU NICHT HANDELN SOLLST:
- Plan-Inhaltsfragen ("was steht heute an") → kurz erklären aus Kontext, kein Tool
- Wissensfragen ("warum macht man Wall Sit") → kurz beantworten, kein Tool
- Medizinische Symptome / Schmerz → auf Sportarzt verweisen, du diagnostizierst nicht

UMGANG MIT TOOL-RESULTATEN:
- Wenn ein Tool eine Änderung gemacht hat: nenne die Anzahl ("3 Sessions angepasst") und sage was der User als nächstes tun sollte (z.B. "App neu laden, dann steht's in /today").
- Wenn ein Tool nichts gefunden hat oder fehlgeschlagen ist: sage warum, schlage Alternative vor.
- Bei HSR-Refusal: erkläre Tendon-Protokoll in 1 Satz und schlage set_therapy_phase als Alternative vor.

KONTEXT-FORMAT:
Du erhältst vor jedem Chat: User-Profil (Goal, Block, VDOT, Trend), aktueller Workout-Plan, optional Knie-/Recovery-Detail-Daten.

SKALEN: Knie X/10, HRV X ms, Sleep X/100, RHR X bpm, Subjective X/10. Niemals Engine-internal Component-Scores.

LÄNGE: 1-3 Sätze ist normal. Bei Wissensfragen mehr wenn die Frage es verlangt. Niemals proaktive Zusammenfassungen oder tägliche Coach-Texte — nur antworten was gefragt ist.`;

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
