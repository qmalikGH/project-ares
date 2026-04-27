// AI summary for a block review.
// Engine has already decided proceed/extend/adjust/defer; AI only narrates.
import type { BlockReviewInput, PhaseTransitionDecision } from "@/lib/coach-engine/types";

export const BLOCK_REVIEW_SYSTEM_PROMPT = `Du bist der AI-Coach von Project Ares. Du fasst das Ende eines 4-Wochen-Trainingsblocks zusammen.

DEINE AUFGABE:
Schreibe eine 4-6 Satz lange Zusammenfassung des Blocks für den User. Erkläre:
1. Wurde das Performance-Ziel erreicht?
2. Wie war der Gesundheits-/Recovery-Verlauf?
3. Was hat die Engine als Nächstes entschieden (PROCEED / EXTEND_PHASE / ADJUST_PHASE / DEFER), und warum?
4. Was sollte der User für den nächsten Block im Kopf behalten (1 konkreter Punkt)?

REGELN:
1. Du erfindest keine Empfehlungen. Die Engine hat entschieden, du erklärst.
2. Tone: kompetent, präzise, ehrlich. Wenn ein Block schlecht lief, sage es klar — kein Schönreden.
3. Antworte auf Deutsch.
4. Nutze konkrete Zahlen aus dem Kontext (TID-Verteilung, ACWR-Schnitt, Readiness-Schnitt, Knee-Trend).
5. Bei medizinischen Themen verweise auf Sportarzt/Physio.`;

export function buildBlockReviewUserContent(
  blockNumber: number,
  phaseName: string,
  input: BlockReviewInput,
  decision: PhaseTransitionDecision,
): string {
  const payload = {
    block: { blockNumber, phaseName },
    blockReview: input,
    engineDecision: decision,
  };
  return `Hier sind die Daten für den abgeschlossenen Block. Schreibe die User-Zusammenfassung in 4-6 Sätzen.

${JSON.stringify(payload, null, 2)}`;
}
