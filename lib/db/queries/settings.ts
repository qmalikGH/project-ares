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
 * The user's effective VDOT, in priority order:
 *   1. UserSettings.vdotOverride (manual override from Settings page)
 *   2. Last verified BlockReview achieved.vdot
 *   3. Initial Block 1 vdotTarget from PhaseConfig
 *   4. 42 (engine default)
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
  if (!macro) return 42;

  // Latest verified VDOT from any block-review (descending by blockNumber)
  for (let i = macro.phases.length - 1; i >= 0; i--) {
    const review = macro.phases[i].blockReview;
    if (!review) continue;
    const r = review.performanceMarkerResult as { achieved?: { vdot?: number } } | null;
    if (r?.achieved?.vdot) return r.achieved.vdot;
  }

  // Fallback: Block 1 target
  const block1 = macro.phases.find((p) => p.blockNumber === 1);
  return (
    (block1?.config as { vdotTarget?: number } | null)?.vdotTarget ?? 42
  );
}
