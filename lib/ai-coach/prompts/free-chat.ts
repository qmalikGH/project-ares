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

KONTEXT-FORMAT:
Vor jedem Chat erhältst du strukturierte Sensor-Daten und Profil-Summary. Behandle das als Hintergrund — beantworte die User-Frage direkt, ziehe nur relevante Daten heran.`;

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
 */
export interface BuildFreeChatRequest {
  profile: FreeChatProfile;
  priorMessages: { role: "user" | "assistant"; content: string }[];
  newUserMessage: string;
  contextBlocks: string[]; // pre-formatted intent-derived context
}

export function buildFreeChatMessages(
  req: BuildFreeChatRequest,
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  // 1. Profile summary as a system-style user message (so it shows up in
  //    history; we keep the actual `system:` field reserved for the frozen
  //    prompt, which is cacheable).
  if (req.contextBlocks.length > 0 || req.profile) {
    const blocks = [formatProfileSummary(req.profile), ...req.contextBlocks].filter(Boolean);
    if (blocks.length > 0) {
      // Wrap as an assistant turn so we don't break the user/assistant alternation
      // — Claude treats this as background context and we tag it accordingly.
      result.push({ role: "user", content: `[KONTEXT — nicht beantworten]\n\n${blocks.join("\n\n")}` });
      result.push({ role: "assistant", content: "Verstanden. Womit kann ich helfen?" });
    }
  }

  // 2. Last 10 prior messages
  const recent = req.priorMessages.slice(-10);
  for (const m of recent) {
    result.push({ role: m.role, content: m.content });
  }

  // 3. New user message
  result.push({ role: "user", content: req.newUserMessage });

  return result;
}
