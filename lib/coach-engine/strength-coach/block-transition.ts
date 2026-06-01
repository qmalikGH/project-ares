// Block-transition Training-Max review (Sprint 2.1 — replaces the orphaned
// v0.11 1RM-divergence proposer, which had zero callers).
//
// Called at the W4 cycle review. Reads the cycle's logged working sets per
// TM-compound and proposes a Training-Max change (5/3/1-style):
//   - clean cycle (reps hit, RPE ≤ target) → +2.5 kg upper / +5 kg lower
//   - stall (reps missed / RPE too high)   → hold
//   - 2× stall in a row                     → TM −10% (re-set)
// HSR lifts (Hex, RDL) are additionally shin-NRS gated (≤3 progress / 4–5 hold
// / >5 step back −5%), since progressive heavy load IS the tendon-remodeling
// stimulus but must yield to an angry shin.
//
// Plus a one-time INITIAL re-baseline: when the best real logged set implies a
// TM >10% above the stored value (the too-low starting TMs), propose snapping
// to that earned estimate instead of a small increment.
//
// All proposals are PROPOSED — never auto-applied. The W4 review page lets Q
// confirm/reject each one; confirmation runs through POST /api/coach/tm-confirm.
//
// The pure decision helpers (evaluateCycleClean, decideTmProposal) are unit-
// tested; buildTrainingMaxProposals is the write-free DB aggregate around them.
import { db } from "@/lib/db/client";
import { checkOneRMDivergence } from "./one-rm";
import { getStrengthTemplate, isHsrLift } from "./index";
import { TM_COMPOUNDS, tmIncrementKg } from "./progression-mode";
import type { BlockNumber } from "../types";

export type TmProposalReason =
  | "earned"
  | "hold_stall"
  | "reset_double_stall"
  | "hold_shin"
  | "stepback_shin"
  | "initial_rebaseline";

export interface TmProposal {
  exerciseName: string;
  /** Stored Training Max (kg) before this proposal. */
  currentTm: number;
  /** Proposed Training Max (kg), snapped to 2.5 kg plates. */
  proposedTm: number;
  /** Signed change in kg (0 = hold). */
  deltaKg: number;
  reason: TmProposalReason;
  /** True when proposedTm !== currentTm (i.e. there is something to confirm). */
  actionable: boolean;
  /** Working sets that informed the decision (for the review UI). */
  dataPoints: number;
  /** Human-readable one-liner for the review card. */
  note: string;
}

/** Snap to 2.5 kg plate increments. */
function snap2p5(kg: number): number {
  return Math.round(kg / 2.5) * 2.5;
}

export interface CompletionTarget {
  /** Prescribed working reps (per side for unilateral). */
  reps: number;
  /** RPE ceiling — a set at/under this counts as clean. */
  rpeCeil: number;
}

export interface LoggedSet {
  weightKg: number;
  repsCompleted: number;
  rpe: number | null;
}

/**
 * Did the athlete complete the cycle cleanly for this exercise?
 *   - null  → no usable data (skip; no proposal)
 *   - true  → the heaviest working set met the prescribed reps at/under the RPE
 *             ceiling (RPE missing but reps met also counts as clean)
 *   - false → stall (top set missed reps, or was over the RPE ceiling)
 *
 * Pure.
 */
export function evaluateCycleClean(
  sets: LoggedSet[],
  target: CompletionTarget,
): boolean | null {
  if (sets.length === 0) return null;
  // The top working set = heaviest; tie-break on most reps.
  const top = [...sets].sort(
    (a, b) => b.weightKg - a.weightKg || b.repsCompleted - a.repsCompleted,
  )[0];
  const repsOk = top.repsCompleted >= target.reps;
  const rpeOk = top.rpe == null || top.rpe <= target.rpeCeil;
  return repsOk && rpeOk;
}

/**
 * Decide the TM proposal from already-evaluated cycle outcomes. Pure — all DB
 * reads happen in the caller.
 *
 * Precedence:
 *   1. HSR shin gate (HSR lifts only): >5 → step back; 4–5 → hold.
 *   2. Initial re-baseline: bestEstimate >10% above currentTm → snap up.
 *   3. Clean → +increment.  Stall → hold, or −10% on a 2nd consecutive stall.
 */
export function decideTmProposal(params: {
  exerciseName: string;
  currentTm: number;
  isHsr: boolean;
  thisCycleClean: boolean | null;
  prevCycleStalled: boolean;
  shinNrs: number | null;
  /** Best 1RM/TM implied by the best real logged set (for initial re-baseline). */
  bestEstimate: number | null;
  dataPoints: number;
}): TmProposal | null {
  const {
    exerciseName,
    currentTm,
    isHsr,
    thisCycleClean,
    prevCycleStalled,
    shinNrs,
    bestEstimate,
    dataPoints,
  } = params;

  if (currentTm <= 0) {
    // No baseline yet — only an initial re-baseline from real data can help.
    if (bestEstimate && bestEstimate > 0) {
      const proposedTm = snap2p5(bestEstimate);
      return {
        exerciseName,
        currentTm,
        proposedTm,
        deltaKg: proposedTm - currentTm,
        reason: "initial_rebaseline",
        actionable: proposedTm !== currentTm,
        dataPoints,
        note: `Kein TM gesetzt → Anker aus bestem Satz: ${proposedTm} kg.`,
      };
    }
    return null;
  }

  const mk = (
    proposedTm: number,
    reason: TmProposalReason,
    note: string,
  ): TmProposal => ({
    exerciseName,
    currentTm,
    proposedTm,
    deltaKg: Math.round((proposedTm - currentTm) * 10) / 10,
    reason,
    actionable: proposedTm !== currentTm,
    dataPoints,
    note,
  });

  // 1. HSR shin gate — overrides normal progression.
  if (isHsr && shinNrs != null) {
    if (shinNrs > 5) {
      return mk(
        snap2p5(currentTm * 0.95),
        "stepback_shin",
        `Shin-NRS ${shinNrs} > 5 → HSR-Last −5% (Sehne schützen).`,
      );
    }
    if (shinNrs >= 4) {
      return mk(currentTm, "hold_shin", `Shin-NRS ${shinNrs} (4–5) → TM halten.`);
    }
    // ≤3 → proceed normally.
  }

  // 2. Initial re-baseline: stored TM is far below earned performance.
  if (bestEstimate && bestEstimate > 0) {
    const div = checkOneRMDivergence(currentTm, bestEstimate);
    if (div && div.pctDiff > 10) {
      const proposedTm = snap2p5(bestEstimate);
      if (proposedTm > currentTm) {
        return mk(
          proposedTm,
          "initial_rebaseline",
          `Bester Satz impliziert ${Math.round(bestEstimate)} kg (+${Math.round(div.pctDiff)}%) → Re-Baseline ${proposedTm} kg.`,
        );
      }
    }
  }

  // 3. Earned / stall.
  if (thisCycleClean === null) return null; // no data → nothing to propose
  if (thisCycleClean) {
    const inc = tmIncrementKg(exerciseName);
    return mk(
      snap2p5(currentTm + inc),
      "earned",
      `Zyklus sauber → +${inc} kg.`,
    );
  }
  // Stall.
  if (prevCycleStalled) {
    return mk(
      snap2p5(currentTm * 0.9),
      "reset_double_stall",
      `2× Stall in Folge → TM −10% (Re-Set).`,
    );
  }
  return mk(currentTm, "hold_stall", `Stall → TM halten (1×).`);
}

// ── DB aggregate ──────────────────────────────────────────────────────────

/** Pull the prescribed reps + RPE ceiling for a TM compound from a block's templates. */
function targetFor(
  blockNumber: BlockNumber,
  exerciseName: string,
  fallbackRpeCeil: number,
): CompletionTarget | null {
  const slots = ["strength_a", "strength_b", "strength_c"] as const;
  let best: { reps: number; rpeCeil: number; loadPct: number } | null = null;
  for (const slot of slots) {
    for (const ex of getStrengthTemplate(blockNumber, slot)) {
      if (ex.name !== exerciseName) continue;
      const reps =
        typeof ex.reps === "number" ? ex.reps : parseInt(String(ex.reps), 10);
      if (!Number.isFinite(reps) || reps <= 0) continue;
      const loadPct = ex.loadPct ?? 0;
      // Prefer the heaviest-loaded occurrence (the primary working slot).
      if (!best || loadPct > best.loadPct) {
        best = { reps, rpeCeil: ex.rpeCap ?? fallbackRpeCeil, loadPct };
      }
    }
  }
  return best ? { reps: best.reps, rpeCeil: best.rpeCeil } : null;
}

/** Worst recent shin NRS across completed sessions (run + strength), or null. */
async function recentWorstShin(userId: string, before: Date): Promise<number | null> {
  const cutoff = new Date(before.getTime() - 14 * 86400000);
  const workouts = await db.workout.findMany({
    where: { userId, status: "completed", date: { gte: cutoff, lte: before } },
    select: { executedSession: true },
  });
  let worst: number | null = null;
  for (const w of workouts) {
    const s = (w.executedSession as { shinPainNrs?: number } | null)?.shinPainNrs;
    if (typeof s === "number") worst = worst == null ? s : Math.max(worst, s);
  }
  return worst;
}

export interface BlockTransitionContext {
  blockNumber: BlockNumber;
  /** Start of the reviewed cycle (phase.startDate). */
  cycleStart: Date;
  /** End of the reviewed cycle (phase.plannedEndDate). */
  cycleEnd: Date;
  /** Start of the previous cycle, for the 2×-stall memory. null if none. */
  prevCycleStart: Date | null;
  /** RPE ceiling fallback when a template entry lacks rpeCap. */
  baselineRpeCap: number;
}

/**
 * Build TM-increment proposals for every TM-compound, reading the reviewed
 * cycle's logged sets (and the prior cycle for stall memory). Write-free.
 */
export async function buildTrainingMaxProposals(
  userId: string,
  currentMaxEstimates: Record<string, number>,
  ctx: BlockTransitionContext,
): Promise<TmProposal[]> {
  const shinNrs = await recentWorstShin(userId, ctx.cycleEnd);
  const proposals: TmProposal[] = [];

  for (const exerciseName of TM_COMPOUNDS) {
    const currentTm = currentMaxEstimates[exerciseName] ?? 0;
    const target = targetFor(ctx.blockNumber, exerciseName, ctx.baselineRpeCap);

    // This-cycle working sets (non-deload), via the snapshot slot column.
    const thisSets = await db.exerciseLog.findMany({
      where: {
        userId,
        exerciseName,
        isDeload: false,
        date: { gte: ctx.cycleStart, lt: ctx.cycleEnd },
      },
      select: { weightKg: true, repsCompleted: true, rpe: true, estimatedOneRM: true },
    });

    // Prev-cycle sets for the 2×-stall memory.
    let prevCycleStalled = false;
    if (ctx.prevCycleStart && target) {
      const prevSets = await db.exerciseLog.findMany({
        where: {
          userId,
          exerciseName,
          isDeload: false,
          date: { gte: ctx.prevCycleStart, lt: ctx.cycleStart },
        },
        select: { weightKg: true, repsCompleted: true, rpe: true },
      });
      const prevClean = evaluateCycleClean(prevSets, target);
      prevCycleStalled = prevClean === false;
    }

    const thisCycleClean = target
      ? evaluateCycleClean(
          thisSets.map((s) => ({
            weightKg: s.weightKg,
            repsCompleted: s.repsCompleted,
            rpe: s.rpe,
          })),
          target,
        )
      : null;

    const bestEstimate =
      thisSets.length > 0
        ? Math.max(...thisSets.map((s) => s.estimatedOneRM))
        : null;

    const proposal = decideTmProposal({
      exerciseName,
      currentTm,
      isHsr: isHsrLift(exerciseName),
      thisCycleClean,
      prevCycleStalled,
      shinNrs,
      bestEstimate,
      dataPoints: thisSets.length,
    });
    if (proposal) proposals.push(proposal);
  }

  // Stable order: actionable first, then by exercise name.
  proposals.sort(
    (a, b) =>
      Number(b.actionable) - Number(a.actionable) ||
      a.exerciseName.localeCompare(b.exerciseName),
  );
  return proposals;
}

/**
 * Convenience wrapper: build TM proposals for a phase by id (resolves the
 * cycle window, previous cycle, and the user's stored TMs). Write-free.
 * Reused by the block-review POST, the W4 review page, and the confirm route.
 */
export async function proposalsForPhase(
  userId: string,
  phaseId: string,
): Promise<TmProposal[]> {
  const phase = await db.phase.findFirst({
    where: { id: phaseId, macrocycle: { userId } },
  });
  if (!phase) return [];

  const prevPhase = await db.phase.findFirst({
    where: {
      macrocycle: { userId },
      plannedEndDate: { lte: phase.startDate },
    },
    orderBy: { plannedEndDate: "desc" },
    select: { startDate: true },
  });

  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { exerciseMaxEstimates: true },
  });
  const currentMaxEstimates =
    (settings?.exerciseMaxEstimates as Record<string, number> | null) ?? {};

  const cfg = phase.config as { strengthRpeCap?: number } | null;

  return buildTrainingMaxProposals(userId, currentMaxEstimates, {
    blockNumber: phase.blockNumber as BlockNumber,
    cycleStart: phase.startDate,
    cycleEnd: phase.plannedEndDate,
    prevCycleStart: prevPhase?.startDate ?? null,
    baselineRpeCap: cfg?.strengthRpeCap ?? 8,
  });
}
