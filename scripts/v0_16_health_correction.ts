// scripts/v0_16_health_correction.ts
//
// Sprint v0.16 Phase A3 — one-time correction of Q's health context.
//
// Usage:
//   npx tsx scripts/v0_16_health_correction.ts
//
// What this does:
//   1. Resolves Q's userId via the same single-user shim used in production.
//   2. Sets therapyPhaseOverride = "REMODELING".
//   3. Sets activeInjuries = ["shin_splints"]   (replaces the legacy
//      "patellar_tendinopathy" reference inherited from goal.constraints).
//   4. Sets preventionExercises = the shin-splint protocol.
//   5. Writes a CoachingLog entry per change so the audit trail starts clean.
//
// Idempotent: re-running just rewrites the same values + logs an extra entry.
//
// Pre-req: `npx prisma migrate dev` must have been run to apply the v0.16
// schema (CoachingLog table + activeInjuries/preventionExercises fields).

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { handleCoachingAction } from "@/lib/coaching-update/handle-action";

const REASON =
  "Sprint v0.16 Phase A3 — one-time correction. Therapy phase has progressed " +
  "from REACTIVE to REMODELING; injury reclassified from patellar_tendinopathy " +
  "to shin_splints; prevention protocol updated accordingly.";

async function main() {
  const userId = await getCurrentUserId();
  console.log(`[v0_16_health_correction] userId = ${userId}`);

  const updates = [
    {
      action: "updateTherapyPhase",
      data: { phase: "REMODELING" },
    },
    {
      action: "updateActiveInjuries",
      data: { injuries: ["shin_splints"] },
    },
    {
      action: "updatePreventionExercises",
      data: {
        exercises: [
          "Tibialis Anterior Raises",
          "Short Foot Exercise",
          "Single-Leg Calf Raises",
        ],
      },
    },
  ];

  for (const u of updates) {
    const r = await handleCoachingAction(userId, u.action, u.data, REASON);
    if (!r.success) {
      console.error(`[FAIL] ${u.action}: ${r.error}`, r.details ?? "");
      process.exit(1);
    }
    console.log(`[ok]   ${u.action} -> CoachingLog ${r.logId}`);
  }

  // Verification readout
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: {
      therapyPhaseOverride: true,
      activeInjuries: true,
      preventionExercises: true,
    },
  });
  console.log("\n[verify] UserSettings now:");
  console.log(JSON.stringify(settings, null, 2));

  await db.$disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
