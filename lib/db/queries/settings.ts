// UserSettings helpers — get-or-create, default values, write helpers.
import { db } from "@/lib/db/client";

export interface NotificationPrefs {
  garminFailure: boolean;
  blockReviewDue: boolean;
  timeTrialToday: boolean;
  vdotCalibrated: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  garminFailure: true,
  blockReviewDue: true,
  timeTrialToday: true,
  vdotCalibrated: true,
};

export async function getOrCreateUserSettings(userId: string) {
  const existing = await db.userSettings.findUnique({ where: { userId } });
  if (existing) return existing;
  return db.userSettings.create({ data: { userId } });
}

/** Effective AI-coach toggle: DB value if present, else env default. */
export async function isAiCoachEnabled(userId: string): Promise<boolean> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  if (settings) return settings.aiCoachEnabled;
  return process.env.ENABLE_AI_COACH === "true";
}

/** Effective AI model: DB override or env default. */
export async function getEffectiveModel(userId: string): Promise<string> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  return (
    settings?.aiModelPrimaryOverride ?? process.env.AI_MODEL_PRIMARY ?? "claude-opus-4-7"
  );
}

/**
 * Sprint 2.6 (A6): what to return when nothing has ever been MEASURED.
 *
 * This used to fall back to Block 1's `config.vdotTarget` (42) — an aspiration,
 * not an observation. Every prescribed pace derives from this number, so using
 * a goal as a fitness estimate prescribes the paces the athlete WANTS to run
 * rather than the ones he can. Clearing the override would have jumped easy pace
 * ~45 s/km faster on the strength of a wish.
 *
 * The unmeasured case therefore resolves to the conservative end of the pace
 * table: too slow costs a bit of stimulus, too fast costs an injury. It is also
 * an exact VDOT_TABLE key, so no silent snapping.
 */
export const VDOT_UNMEASURED_FALLBACK = 35;

/**
 * The user's effective VDOT, in priority order:
 *   1. UserSettings.vdotOverride — set at onboarding and by every calibration
 *      path (manual, block test, W1, auto-rolling). In practice always present.
 *   2. Last verified BlockReview achieved.vdot — see the note below; inert today.
 *   3. VDOT_UNMEASURED_FALLBACK.
 *
 * Never falls back to a block's vdotTarget.
 */
export async function getEffectiveVdot(userId: string): Promise<number> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  if (settings?.vdotOverride != null) return settings.vdotOverride;

  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
        include: { blockReview: true },
      },
    },
  });
  if (!macro) return VDOT_UNMEASURED_FALLBACK;

  // Latest verified VDOT from any block-review (descending by blockNumber).
  //
  // DELIBERATELY INERT — do not "fix" the shape in isolation. The writer
  // (app/api/coach/block-review/route.ts) emits a FLAT `{ achievedVdot }` while
  // this reads a nested `{ achieved: { vdot } }`, so the branch never matches.
  // That mismatch is currently load-bearing: the same route sets
  // `achievedVdot = targetVdot` as an explicit v0.1 placeholder, so making this
  // read succeed would feed the block TARGET back in as a measured value —
  // exactly the aspiration-as-observation bug removed below, reintroduced
  // through the side door. Both get fixed together in A1 (block-review honesty),
  // where the marker learns to say "not measured". Pinned by
  // tests/db/effective-vdot.test.ts.
  for (let i = macro.phases.length - 1; i >= 0; i--) {
    const review = macro.phases[i].blockReview;
    if (!review) continue;
    const r = review.performanceMarkerResult as { achieved?: { vdot?: number } } | null;
    if (r?.achieved?.vdot) return r.achieved.vdot;
  }

  return VDOT_UNMEASURED_FALLBACK;
}
