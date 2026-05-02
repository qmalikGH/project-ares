// Focus-Mode-spezifische BLOCK_CONFIGS (Sprint v0.14) — pure module.
//
// Modifiziert die Standard-BLOCK_CONFIGS basierend auf dem
// Gap-Analyse-Ergebnis. Drei Modi neben "balanced":
//
// STRENGTH_FOCUS (Petré 2021: dedizierte Kraft-Blöcke bei Trainierten):
//   - strengthMode bleibt "linear_progression" durch B1–B4
//   - strengthRpeCap erhöht auf 9 ab Block 3
//   - Run-Baselines auf 80% reduziert (Maintenance)
//   - Easy-Baselines auf 85% (minimal-effective dose)
//
// ENDURANCE_FOCUS:
//   - strengthMode = "maintenance" alle Blöcke
//   - strengthRpeCap gesenkt auf 7
//   - Run-Baselines auf 120% erhöht (Long Run + Quality)
//   - Quality-Baselines auf 115%
//
// RECOMP (Garthe 2011: 0.7% BW/Woche optimal):
//   - Wie "balanced", aber Block 1 konservativer Start
//   - Long + Quality Baselines auf 90% in B1
//   - Ab B2 normale Progression

import type { BlockNumber, MacrocycleFocus, PhaseConfig } from "../types";

/**
 * Adjust BLOCK_CONFIGS for a given focus mode.
 *
 * Returns a NEW config record — does not mutate the input.
 * When focus is "balanced", returns the input unchanged (reference equality).
 */
export function adjustBlockConfigsForFocus(
  baseConfigs: Record<BlockNumber, PhaseConfig>,
  focus: MacrocycleFocus,
): Record<BlockNumber, PhaseConfig> {
  if (focus === "balanced") return baseConfigs;

  const adjusted = {} as Record<BlockNumber, PhaseConfig>;

  for (let i = 1; i <= 5; i++) {
    const block = i as BlockNumber;
    const config = { ...baseConfigs[block] };

    switch (focus) {
      case "strength_focus":
        // Kraft bleibt linear progression durch B1-B4, Maintenance nur B5
        config.strengthMode = block <= 4 ? "linear_progression" : "maintenance";
        config.strengthRpeCap = block >= 3 ? 9 : 8;
        config.longRunBaselineMin = Math.round((config.longRunBaselineMin ?? 60) * 0.80);
        config.qualityRunBaselineMin = Math.round((config.qualityRunBaselineMin ?? 40) * 0.80);
        config.easyRunBaselineMin = Math.round((config.easyRunBaselineMin ?? 35) * 0.85);
        break;

      case "endurance_focus":
        // Kraft in Maintenance, Run-Volumen erhöht
        config.strengthMode = "maintenance";
        config.strengthRpeCap = 7;
        config.longRunBaselineMin = Math.round((config.longRunBaselineMin ?? 60) * 1.20);
        config.qualityRunBaselineMin = Math.round((config.qualityRunBaselineMin ?? 40) * 1.15);
        // Easy bleibt gleich — Volumen-Steigerung kommt über Long + Quality
        break;

      case "recomp":
        // Wie balanced, aber konservativer Start — kein Extra-Volumen im Defizit
        if (block === 1) {
          config.longRunBaselineMin = Math.round((config.longRunBaselineMin ?? 60) * 0.90);
          config.qualityRunBaselineMin = Math.round((config.qualityRunBaselineMin ?? 40) * 0.90);
        }
        break;
    }

    adjusted[block] = config;
  }

  return adjusted;
}
