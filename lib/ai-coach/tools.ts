// Sprint v0.12 Phase 3 — Anthropic.Tool[] definitions for the coach.
//
// Cache strategy: prompt cache uses prefix-match. Render order is
// `tools` → `system` → `messages`. To keep `cache_read` hits when only
// the user's message changes:
//   1. Tools array stays byte-identical across requests (deterministic JSON,
//      same order, no timestamps or per-user fields anywhere in here).
//   2. `cache_control: { type: "ephemeral" }` lives on the LAST tool — that
//      breakpoint covers everything before it (the whole tools array).
//   3. The system prompt also has its own `cache_control` (set in the route)
//      so the tools+system prefix is one cached block.
//
// If you add a new tool: append to the END of the array and move the
// cache_control marker to the new last entry. Editing or reordering existing
// tools invalidates the prefix.

import type Anthropic from "@anthropic-ai/sdk";

export const COACH_TOOLS: Anthropic.Tool[] = [
  {
    name: "substitute_exercise",
    description:
      "Ersetze eine Übung im zukünftigen Trainingsplan durch eine biomechanisch äquivalente Alternative. Nutze dies wenn der User Schmerzen bei einer Übung hat oder Equipment nicht verfügbar ist. WICHTIG: HSR-Lifts (Hex Bar Deadlift, Romanian Deadlift) sind tendon-protokoll-geschützt (Kongsgaard 2009) und können NICHT ersetzt werden — bei Knie-Beschwerden mit diesen Lifts stattdessen set_therapy_phase nutzen.",
    input_schema: {
      type: "object",
      properties: {
        exerciseName: {
          type: "string",
          description:
            "Name der zu ersetzenden Übung (exakt wie im Plan, z.B. 'Bench Press', 'Bulgarian Split Squat').",
        },
        replacementName: {
          type: "string",
          description: "Name der Ersatzübung (z.B. 'Floor Press').",
        },
        replacementSets: {
          type: "number",
          description:
            "Sets für die Ersatzübung. Optional — wenn weggelassen, übernimmt die ursprünglichen Sets.",
        },
        replacementReps: {
          type: "string",
          description:
            "Reps als Zahl-String oder Format wie '10/leg' / '30sec hold'. Optional.",
        },
        replacementLoadPct: {
          type: "number",
          description:
            "Last in Prozent vom 1RM (z.B. 70 für 70%). Optional — nur für Lifts mit Prozent-Vorgabe.",
        },
        replacementRpeCap: {
          type: "number",
          description: "RPE-Cap (1-10). Optional.",
        },
        replacementTempo: {
          type: "string",
          description: "Tempo wie '2-1-1' oder '3-3-1'. Optional.",
        },
        replacementRestSec: {
          type: "number",
          description: "Pause in Sekunden. Optional.",
        },
        replacementNotes: {
          type: "string",
          description: "Notiz zur Ersetzung (Begründung). Optional.",
        },
        scope: {
          type: "string",
          enum: ["this_week", "this_block", "permanent"],
          description:
            "Gültigkeitsbereich. 'this_week' = nur die laufende Woche, 'this_block' = bis zum Ende des aktuellen Blocks (Phase), 'permanent' = alle zukünftigen Sessions.",
        },
      },
      required: ["exerciseName", "replacementName", "scope"],
    },
  },
  {
    name: "adjust_run_volume",
    description:
      "Passe das Laufvolumen aller zukünftigen Run-Sessions an. multiplier=0.8 bedeutet -20%, 1.2 bedeutet +20%. Sinnvoll bei Shin Splints (-20%) oder wenn der User mehr Volumen will (+10-15%). Strength-Sessions sind nicht betroffen.",
    input_schema: {
      type: "object",
      properties: {
        multiplier: {
          type: "number",
          description:
            "Volumen-Multiplikator. 0.8 = -20%, 1.0 = unverändert, 1.2 = +20%. Zulässiger Bereich 0–2.",
        },
        scope: {
          type: "string",
          enum: ["this_week", "next_2_weeks", "rest_of_block"],
          description:
            "Gültigkeitsbereich. 'this_week', 'next_2_weeks' = die nächsten 14 Tage, 'rest_of_block' = bis Block-Ende.",
        },
      },
      required: ["multiplier", "scope"],
    },
  },
  {
    name: "set_therapy_phase",
    description:
      "Ändere die Knie-Therapy-Phase. REACTIVE/DISREPAIR fügen Wall Sit als Tendon-Loading-Stimulus in jede Strength-Session ein und reduzieren Lasten. REMODELING/SPORT_SPECIFIC entfernen Wall Sit und erlauben volle Lasten. Nutze dies bei akuten Knieschmerzen (REACTIVE), Belastungsschmerzen (DISREPAIR), oder wenn die Tendinopathie abgeklungen ist (REMODELING/SPORT_SPECIFIC).",
    input_schema: {
      type: "object",
      properties: {
        phase: {
          type: "string",
          enum: ["REACTIVE", "DISREPAIR", "REMODELING", "SPORT_SPECIFIC"],
          description:
            "REACTIVE: akute Schmerzen. DISREPAIR: Schmerzen nach Belastung. REMODELING: selten Schmerzen. SPORT_SPECIFIC: beschwerdefrei.",
        },
      },
      required: ["phase"],
    },
  },
  {
    name: "skip_session",
    description:
      "Überspringe eine geplante Session an einem bestimmten Datum. Setzt die Session als Ruhetag im Plan und entfernt einen ggf. an Garmin gepushten Workout. Nutze dies wenn der User wegen Krankheit, Reise oder anderen Verpflichtungen ausfällt.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Datum im Format YYYY-MM-DD (z.B. '2026-04-30'). Muss in der Zukunft oder heute sein.",
        },
        reason: {
          type: "string",
          description:
            "Kurze Begründung (wird in den Notes gespeichert), z.B. 'krank', 'Reise', 'Familienverpflichtung'.",
        },
        type: {
          type: "string",
          description:
            "Optional: nur Sessions dieses Typs überspringen (z.B. 'easy_run' wenn nur der Run, aber nicht das Strength-Workout entfallen soll). Wenn weggelassen, werden alle Nicht-Rest-Sessions an diesem Datum übersprungen.",
        },
      },
      required: ["date", "reason"],
    },
  },
  {
    name: "reschedule_session",
    description:
      "Verschiebe eine geplante Session auf einen anderen Tag innerhalb derselben Woche. Nutze dies bei legitimen Gründen (Termin, leichte Krankheit) wenn ein anderer Tag offen ist. Validiert Periodisierungs-Regeln (24h-Gap zu Strength A für Quality-Runs, Pflicht-Ruhetage, Slot-Konflikte, Tagesdichte). Bei Validierungsfehler kommt eine deutsche Begründung zurück — dann dem User erklären und ggf. skip_session vorschlagen. Cross-Week ist explizit nicht unterstützt — dafür skippen und manuell neu planen.",
    input_schema: {
      type: "object",
      properties: {
        fromDate: {
          type: "string",
          description:
            "Quell-Datum YYYY-MM-DD (z.B. '2026-05-05'). Muss eine planbare Session enthalten.",
        },
        toDate: {
          type: "string",
          description:
            "Ziel-Datum YYYY-MM-DD. Muss in derselben Trainingswoche wie fromDate liegen.",
        },
        reason: {
          type: "string",
          description:
            "Kurze Begründung für die Verschiebung, z.B. 'Termin am Dienstag', 'leichte Erkältung'.",
        },
        type: {
          type: "string",
          description:
            "Optional: spezifischer Session-Typ falls fromDate mehrere Sessions hat (z.B. 'easy_run' wenn nur der Run, nicht aber das Strength-Workout verschoben werden soll). Pflicht wenn fromDate mehrdeutig ist.",
        },
      },
      required: ["fromDate", "toDate", "reason"],
    },
  },
];

// Sprint v0.12: cache the tools array. Anthropic SDK accepts cache_control on
// the last tool object — the rendered prefix up to (and including) that tool
// becomes one cached block. Combined with the cache_control on the system
// prompt (set in the route), tools + system are cached together.
const lastTool = COACH_TOOLS[COACH_TOOLS.length - 1];
(lastTool as Anthropic.Tool & {
  cache_control?: { type: "ephemeral" };
}).cache_control = { type: "ephemeral" };
