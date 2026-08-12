// Dry-run + weight resolution for nutrition config changes — Sprint 2.7 (A5).
//
// Extracted from handle-action.ts, where it already guarded the coaching
// actions, so the CALIBRATION path can use the same guard. Calibration was the
// one writer without it: it updated every DayTypeConfig row and only then
// called the all-or-nothing cascade, so when the cascade rejected the values
// the configs were already written and never rolled back. That is exactly how
// the 2026-06-15 split happened.
//
// Not a leaf module — it reads the DB by design (one implementation, one
// behaviour, no second copy to drift).

import { db } from "@/lib/db/client";
import { buildAllDayPlans } from "./build-all-day-plans";
import { ATHLETE_WEIGHT_KG } from "./day-type-configs";
import { RECIPE_TEMPLATES } from "./recipe-templates";
import { dbConfigToEngineConfig } from "./seed-day-type-configs";
import type { DayTypeConfig } from "./types";

/**
 * The body mass every nutrition floor is computed against.
 *
 * Sprint 2.7: `targetWeightKg` was removed from this chain. A goal is not a
 * measurement — using it silently lowered the protein and fat floors whenever
 * no weigh-in existed, and it lowers them further now that the goal is 84 kg.
 * The fallback is the deliberately-high ATHLETE_WEIGHT_KG, which errs toward
 * MORE protein and fat, not less.
 */
export async function resolveAthleteWeightKg(userId: string): Promise<number> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { currentWeightKg: true },
  });
  return settings?.currentWeightKg ?? ATHLETE_WEIGHT_KG;
}

export type DryRunResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Apply `mutate` to the plan's configs IN MEMORY and run the full engine over
 * the result. Nothing is written. `mutate` returns an error string to abort.
 */
export async function dryRunConfigChange(
  planId: string,
  userId: string,
  mutate: (configs: DayTypeConfig[]) => string | null,
): Promise<DryRunResult> {
  const dbConfigs = await db.dayTypeConfig.findMany({ where: { planId } });
  if (dbConfigs.length === 0) {
    return { ok: false, errors: ["No DayTypeConfigs found — run seedMealPlan first"] };
  }

  const configs = dbConfigs.map(dbConfigToEngineConfig);
  const mutateError = mutate(configs);
  if (mutateError) {
    return { ok: false, errors: [mutateError] };
  }

  const weight = await resolveAthleteWeightKg(userId);

  const result = buildAllDayPlans(configs, RECIPE_TEMPLATES, weight);
  if (result.hasErrors) {
    return { ok: false, errors: result.allErrors };
  }
  return { ok: true };
}
