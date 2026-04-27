// POST /api/blocks/[phaseId]/test-result
// Body: discriminated union by `testType`:
//   - "long_run_progressive_w_threshold": user reports threshold-segment splits
//   - "time_trial_5k": user reports finish time
//   - "tempo_test_3k": user reports 3k time, Riegel-converts to 5k-equivalent
//
// Effects (sequential):
//   1. Compute VDOT from the test (vdot-table inverse).
//   2. Persist phase.performanceMarker with achievedVdot + raw test details.
//   3. Trigger VDOT-Override propagation → all future planned run paces refreshed.
//   4. Notify user (VDOT_CALIBRATED).
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import { regenerateFutureSessionPaces } from "@/lib/db/queries/regenerate";
import {
  riegelEquivalent,
  vdotFrom5k,
  vdotFromTPace,
} from "@/lib/coach-engine/vdot-table";
import { createNotification } from "@/lib/notifications/create";

// ===== Schemas =====
const ThresholdSplitSchema = z.object({
  /** Pace in sec/km for this km of the threshold segment. */
  paceSecPerKm: z.number().min(120).max(600),
  /** Average HR in bpm (optional — for context, not used in VDOT calc). */
  averageHr: z.number().int().min(60).max(220).nullable().optional(),
});

const LongRunProgressiveSchema = z.object({
  testType: z.literal("long_run_progressive_w_threshold"),
  testDate: z.string().datetime(),
  /** The threshold segment splits (typically 3-5 km at LT2). */
  thresholdSplits: z.array(ThresholdSplitSchema).min(1).max(20),
  /** Optional notes from the athlete (felt strong / had pain / etc.). */
  notes: z.string().max(2000).optional(),
});

const TimeTrial5kSchema = z.object({
  testType: z.literal("time_trial_5k"),
  testDate: z.string().datetime(),
  /** 5000m race time in seconds. */
  finishTimeSec: z.number().int().min(8 * 60).max(60 * 60),
  notes: z.string().max(2000).optional(),
});

const Tempo3kSchema = z.object({
  testType: z.literal("tempo_test_3k"),
  testDate: z.string().datetime(),
  finishTimeSec: z.number().int().min(5 * 60).max(40 * 60),
  notes: z.string().max(2000).optional(),
});

const BodySchema = z.discriminatedUnion("testType", [
  LongRunProgressiveSchema,
  TimeTrial5kSchema,
  Tempo3kSchema,
]);

// ===== VDOT computation =====
interface ComputedTest {
  achievedVdot: number;
  /** Raw inputs + intermediates for transparency in performanceMarker. */
  detail: Record<string, unknown>;
}

function computeFromBody(body: z.infer<typeof BodySchema>): ComputedTest {
  if (body.testType === "long_run_progressive_w_threshold") {
    const splits = body.thresholdSplits;
    const meanPace =
      splits.reduce((sum, s) => sum + s.paceSecPerKm, 0) / splits.length;
    const achievedVdot = vdotFromTPace(meanPace);
    return {
      achievedVdot,
      detail: {
        testType: body.testType,
        thresholdSplits: splits,
        meanThresholdPaceSecPerKm: Math.round(meanPace * 10) / 10,
        kmCount: splits.length,
        notes: body.notes ?? null,
      },
    };
  }
  if (body.testType === "time_trial_5k") {
    const achievedVdot = vdotFrom5k(body.finishTimeSec);
    return {
      achievedVdot,
      detail: {
        testType: body.testType,
        finishTimeSec: body.finishTimeSec,
        notes: body.notes ?? null,
      },
    };
  }
  // tempo_test_3k → Riegel-equivalent 5k → VDOT
  const equiv5kSec = riegelEquivalent(3000, body.finishTimeSec, 5000);
  const achievedVdot = vdotFrom5k(equiv5kSec);
  return {
    achievedVdot,
    detail: {
      testType: body.testType,
      finishTimeSec: body.finishTimeSec,
      riegelEquiv5kSec: Math.round(equiv5kSec),
      notes: body.notes ?? null,
    },
  };
}

// ===== Route =====
export async function POST(
  req: Request,
  { params }: { params: Promise<{ phaseId: string }> },
) {
  const { phaseId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();

  const phase = await db.phase.findFirst({
    where: { id: phaseId, macrocycle: { userId } },
    include: { macrocycle: true },
  });
  if (!phase) {
    return NextResponse.json({ status: "PHASE_NOT_FOUND" }, { status: 404 });
  }

  const previousVdot = await getEffectiveVdot(userId);
  const phaseConfig = phase.config as { vdotTarget?: number } | null;
  const targetVdot = phaseConfig?.vdotTarget ?? null;

  const { achievedVdot, detail } = computeFromBody(parsed.data);

  // Round to integer for VDOT override (UserSettings.vdotOverride is Int).
  const newVdot = Math.round(achievedVdot);
  const close =
    targetVdot != null && Math.abs(achievedVdot - targetVdot) <= 1.0;
  const met = targetVdot != null && achievedVdot >= targetVdot;

  // 1. Persist on phase
  await db.phase.update({
    where: { id: phase.id },
    data: {
      performanceMarker: {
        ...detail,
        testDate: parsed.data.testDate,
        achievedVdot,
        targetVdot,
        met,
        close,
        recordedAt: new Date().toISOString(),
      },
    },
  });

  // 2. Persist as VDOT override (so getEffectiveVdot picks it up).
  await db.userSettings.upsert({
    where: { userId },
    update: {
      vdotOverride: newVdot,
      vdotOverrideAt: new Date(),
      vdotOverrideRationale: `Block ${phase.blockNumber} Test (${parsed.data.testType}): VDOT ${achievedVdot.toFixed(1)} → ${newVdot}`,
    },
    create: {
      userId,
      vdotOverride: newVdot,
      vdotOverrideAt: new Date(),
      vdotOverrideRationale: `Block ${phase.blockNumber} Test (${parsed.data.testType}): VDOT ${achievedVdot.toFixed(1)} → ${newVdot}`,
    },
  });

  // 3. Regenerate future paces
  const { updatedSessions, updatedPlans, newPaces } =
    await regenerateFutureSessionPaces(userId, newVdot);

  // 4. Notify (respects user prefs)
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const prefs = settings?.notificationPrefs as
    | { vdotCalibrated?: boolean }
    | null;
  if (prefs?.vdotCalibrated !== false) {
    await createNotification({
      userId,
      type: "VDOT_CALIBRATED",
      title: `Block ${phase.blockNumber} Test ausgewertet`,
      message: `VDOT ${previousVdot} → ${newVdot} (${parsed.data.testType}). ${updatedSessions} Sessions mit neuen Paces.`,
      severity: met ? "INFO" : "WARNING",
      actionUrl: `/blocks/${phase.id}`,
    });
  }

  return NextResponse.json({
    status: "ok",
    phaseId: phase.id,
    blockNumber: phase.blockNumber,
    previousVdot,
    achievedVdot,
    newVdot,
    targetVdot,
    met,
    close,
    detail,
    regenerated: { updatedSessions, updatedPlans, newPaces },
  });
}
