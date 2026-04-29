// Block-transition 1RM review (Sprint v0.11).
//
// Called during W4 (Deload) of each block — or any time the user wants to
// reconcile their stored 1RM against actual training data. Reads the last
// 28 days of ExerciseLog rows per exercise, computes a rolling-median 1RM
// estimate, and returns the diffs that exceed ±10% (the divergence threshold
// from `checkOneRMDivergence`). The user confirms or rejects each proposal —
// no auto-apply.
//
// Not a pure module (DB reads), but write-free. Treat as a read-side aggregate
// that wraps the pure `rollingOneRMEstimate` + `checkOneRMDivergence` core.
import { db } from "@/lib/db/client";
import {
  rollingOneRMEstimate,
  checkOneRMDivergence,
} from "./one-rm";

export interface OneRMUpdateProposal {
  exerciseName: string;
  /** User's currently-set 1RM in kg. */
  currentRM: number;
  /** Engine-estimated 1RM (rolling median over the lookback window). */
  proposedRM: number;
  /** Signed change (positive = strength gained). */
  pctChange: number;
  /** Number of training-set data points the proposal is based on. */
  dataPoints: number;
  source: "epley_4week_median";
}

/**
 * Inspect the last `lookbackDays` (default 28) of ExerciseLog for the user
 * and return proposals where the engine's rolling estimate diverges from
 * the user's stored 1RM by more than 10%.
 *
 * Exercises with fewer than 2 logs in the window are skipped (the rolling
 * estimator returns null below 2 points). Exercises currently set to 0 or
 * missing entirely are also skipped — only update what already exists.
 */
export async function proposeOneRMUpdates(
  userId: string,
  currentMaxEstimates: Record<string, number>,
  lookbackDays = 28,
): Promise<OneRMUpdateProposal[]> {
  const proposals: OneRMUpdateProposal[] = [];
  const cutoff = new Date(Date.now() - lookbackDays * 86400000);

  for (const [exerciseName, currentRM] of Object.entries(currentMaxEstimates)) {
    if (typeof currentRM !== "number" || currentRM <= 0) continue;

    const logs = await db.exerciseLog.findMany({
      where: { userId, exerciseName, date: { gte: cutoff } },
      orderBy: { date: "desc" },
    });
    if (logs.length < 2) continue;

    const rollingEstimate = rollingOneRMEstimate(
      logs.map((l) => ({
        weightKg: l.weightKg,
        reps: l.repsCompleted,
        rpe: l.rpe ?? undefined,
      })),
    );
    if (rollingEstimate === null) continue;

    const divergence = checkOneRMDivergence(currentRM, rollingEstimate);
    if (!divergence?.divergent) continue;

    proposals.push({
      exerciseName,
      currentRM,
      proposedRM: Math.round(rollingEstimate),
      pctChange: divergence.pctDiff,
      dataPoints: logs.length,
      source: "epley_4week_median",
    });
  }

  return proposals;
}
