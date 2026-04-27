// Pace-target regeneration for future planned run sessions.
// Extracted from /api/settings/vdot-override (Sprint v0.6) so the same logic
// can be triggered both by manual VDOT override and by Block-Review test results.
//
// Pure-ish: takes the userId + new VDOT, performs DB updates. The actual
// pace mapping (intensityZone → bucket) is delegated to run-coach (pure).
import { db } from "@/lib/db/client";
import { dayKey } from "./sensors";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import type { SessionPlan } from "@/lib/coach-engine/types";
import { isRunType } from "./progress-helpers";

export interface RegenerateResult {
  updatedSessions: number;
  updatedPlans: number;
  newPaces: ReturnType<typeof vdotToPaces>;
}

/**
 * Regenerate paceTarget on every PLANNED, FUTURE run session for a user,
 * derived from `newVdot`. Past, in-progress, and completed sessions are not
 * touched. Strength sessions are skipped.
 *
 * Why: when VDOT changes (manual override or block-review calibration), all
 * paces in the upcoming weekly plans need to follow. Doing this once at write
 * time keeps the daily Today/Plan UIs free of recompute logic.
 */
export async function regenerateFutureSessionPaces(
  userId: string,
  newVdot: number,
  today: Date = new Date(),
): Promise<RegenerateResult> {
  const today0 = dayKey(today);
  const newPaces = vdotToPaces(newVdot);

  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: { phases: { include: { weeklyPlans: true } } },
  });

  let updatedSessions = 0;
  let updatedPlans = 0;
  if (!macro) return { updatedSessions, updatedPlans, newPaces };

  for (const phase of macro.phases) {
    for (const wp of phase.weeklyPlans) {
      const sessions = wp.plannedSessions as unknown as SessionPlan[];
      if (!Array.isArray(sessions)) continue;
      let modified = false;
      const next = sessions.map((s) => {
        const sDate = s.date instanceof Date ? s.date : new Date(s.date);
        if (sDate.getTime() <= today0.getTime()) return s; // past or today
        if (!isRunType(s.type)) return s;
        let paceTarget = s.paceTarget;
        if (s.intensityZone === 1) {
          paceTarget = newPaces.E;
        } else if (s.intensityZone === 2) {
          paceTarget = { from: newPaces.T, to: newPaces.T };
        } else if (s.intensityZone === 3) {
          paceTarget = { from: newPaces.I, to: newPaces.I };
        } else {
          return s;
        }
        modified = true;
        return { ...s, paceTarget };
      });
      if (modified) {
        await db.weeklyPlan.update({
          where: { id: wp.id },
          data: { plannedSessions: next as unknown as object },
        });
        updatedPlans += 1;
        updatedSessions += next.filter(
          (s, i) => JSON.stringify(s) !== JSON.stringify(sessions[i]),
        ).length;
      }
    }
  }

  return { updatedSessions, updatedPlans, newPaces };
}
