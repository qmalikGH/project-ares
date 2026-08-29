// Server-side notification helper. Call from cron jobs / API routes when a
// notification-worthy event occurs.
import { db } from "@/lib/db/client";

export type NotificationType =
  | "GARMIN_SYNC_FAILURE"
  | "VDOT_CALIBRATED"
  | "BLOCK_REVIEW_DUE"
  | "TIME_TRIAL_TODAY"
  | "WEIGHT_LOSS_RATE"
  // Sprint 2.7 (A5): the nutrition cascade is all-or-nothing, so a failure
  // leaves the stores split without changing anything the user can see. It went
  // unnoticed from 2026-06-15 to 2026-08-12. This is the alarm.
  | "NUTRITION_CASCADE_FAILED"
  // Sprint 3.0: sessions the Garmin import completed or could not prove, still
  // waiting for an RPE and a shin score. Without them the volume gate stays on
  // hold and the training max cannot move.
  | "SESSIONS_AWAITING_CONFIRMATION";

export type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  actionUrl?: string;
}

export async function createNotification(input: CreateNotificationInput) {
  return db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity ?? "INFO",
      actionUrl: input.actionUrl ?? null,
    },
  });
}

/**
 * Idempotent variant — skip if a same-type unread notification was created in
 * the last `dedupeMinutes`. Useful for cron jobs that might fire twice.
 */
export async function createNotificationIfNew(
  input: CreateNotificationInput,
  dedupeMinutes = 60,
) {
  const cutoff = new Date(Date.now() - dedupeMinutes * 60 * 1000);
  const existing = await db.notification.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      createdAt: { gte: cutoff },
      read: false,
    },
  });
  if (existing) return existing;
  return createNotification(input);
}
