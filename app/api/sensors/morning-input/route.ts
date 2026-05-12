// POST /api/sensors/morning-input
// Stores user's morning self-assessment + optional body weight.
// Triggers re-computation on next /sessions/today call.
// Sprint v0.15: bodyWeightKg added — computes 7d avg, updates UserSettings,
// checks weight loss rate for safety notifications.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { createNotificationIfNew } from "@/lib/notifications/create";

const Schema = z.object({
  date: z.string().optional(), // ISO; defaults to today
  subjectiveRecovery: z.number().int().min(1).max(10),
  morningStiffness: z.number().int().min(1).max(10),
  stairsScore: z.number().int().min(1).max(10),
  // Sprint v0.15: optional body weight
  bodyWeightKg: z.number().min(40).max(200).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  const date = dayKey(parsed.data.date ? new Date(parsed.data.date) : new Date());

  const userMorning = {
    subjectiveRecovery: parsed.data.subjectiveRecovery,
    morningStiffness: parsed.data.morningStiffness,
    stairsScore: parsed.data.stairsScore,
  };

  // Build update data — bodyWeight fields only when a value was submitted
  const weightData = parsed.data.bodyWeightKg != null
    ? { bodyWeightKg: parsed.data.bodyWeightKg, bodyWeightSource: "manual" as const }
    : {};

  // Upsert by (userId, date). Schema only has unique on date alone; use findFirst+update.
  const existing = await db.dailySensorData.findFirst({ where: { userId, date } });
  const row = existing
    ? await db.dailySensorData.update({
        where: { id: existing.id },
        data: { userMorning, ...weightData, updatedAt: new Date() },
      })
    : await db.dailySensorData.create({
        data: { userId, date, userMorning, ...weightData },
      });

  // ── Sprint v0.15: 7-day weight average + UserSettings update ──
  let currentAvg: number | null = null;

  if (parsed.data.bodyWeightKg != null) {
    const recentWeights = await db.dailySensorData.findMany({
      where: {
        userId,
        bodyWeightKg: { not: null },
        date: { gte: new Date(Date.now() - 7 * 86400000) },
      },
      orderBy: { date: "desc" },
      take: 7,
      select: { bodyWeightKg: true },
    });

    if (recentWeights.length > 0) {
      const avg = recentWeights.reduce((sum, w) => sum + w.bodyWeightKg!, 0) / recentWeights.length;
      currentAvg = Math.round(avg * 10) / 10;
      await db.userSettings.update({
        where: { userId },
        data: { currentWeightKg: currentAvg, currentWeightUpdatedAt: new Date() },
      });

      // ── v1.3: Protein cascade when weight changes ≥2g protein ──
      const newProteinMin = Math.ceil(currentAvg * 2.0);
      const activePlan = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        include: { dayTypeConfigs: { select: { proteinG: true }, take: 1 } },
      });

      if (activePlan && activePlan.dayTypeConfigs.length > 0) {
        const currentProteinG = activePlan.dayTypeConfigs[0].proteinG;
        if (Math.abs(newProteinMin - currentProteinG) >= 2) {
          await db.dayTypeConfig.updateMany({
            where: { planId: activePlan.id },
            data: { proteinG: newProteinMin },
          });
          const { cascadeNutritionUpdate } = await import("@/lib/nutrition/cascade");
          await cascadeNutritionUpdate(
            activePlan.id,
            "weight_change",
            `Weight ${currentAvg}kg → proteinG ${newProteinMin}g (was ${currentProteinG}g)`,
          );
        }
      }
    }

    // ── Weight loss rate check (≥14 days of data) ──
    const twoWeeksAgo = await db.dailySensorData.findFirst({
      where: {
        userId,
        bodyWeightKg: { not: null },
        date: { lte: new Date(Date.now() - 14 * 86400000) },
      },
      orderBy: { date: "desc" },
      select: { bodyWeightKg: true, date: true },
    });

    if (twoWeeksAgo && currentAvg) {
      const daysBetween = Math.max(1, (Date.now() - twoWeeksAgo.date.getTime()) / 86400000);
      const weeksBetween = daysBetween / 7;
      const weeklyLossKg = (twoWeeksAgo.bodyWeightKg! - currentAvg) / weeksBetween;
      const weeklyLossPct = (weeklyLossKg / twoWeeksAgo.bodyWeightKg!) * 100;

      // Warning: >1.0% BW/week → FFM loss risk (Garthe 2011)
      if (weeklyLossPct > 1.0) {
        await createNotificationIfNew(
          {
            userId,
            type: "WEIGHT_LOSS_RATE",
            title: "Gewichtsreduktion zu schnell",
            message: `Aktuelle Rate: ${weeklyLossPct.toFixed(1)}%/Woche (${weeklyLossKg.toFixed(1)} kg/Woche). Garthe 2011 zeigt: >1.0%/Woche erhöht FFM-Verlust-Risiko. Empfehlung: Defizit reduzieren auf ≤500 kcal/Tag.`,
            severity: "WARNING",
          },
          24 * 60, // dedupe 24h
        );
      }

      // Info: <0.3% → insufficient progress
      if (weeklyLossPct > 0 && weeklyLossPct < 0.3) {
        await createNotificationIfNew(
          {
            userId,
            type: "WEIGHT_LOSS_RATE",
            title: "Gewichtsreduktion sehr langsam",
            message: `Aktuelle Rate: ${weeklyLossPct.toFixed(1)}%/Woche. Zielbereich: 0.5–0.7%/Woche. Bei Bedarf Kaloriendefizit leicht erhöhen.`,
            severity: "INFO",
          },
          24 * 60, // dedupe 24h
        );
      }
    }
  }

  return NextResponse.json({ status: "ok", id: row.id, currentWeightKg: currentAvg });
}

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dayKey(dateParam ? new Date(dateParam) : new Date());
  const row = await db.dailySensorData.findFirst({ where: { userId, date } });
  return NextResponse.json({ data: row });
}
