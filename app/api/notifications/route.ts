// GET /api/notifications — list (with unread count)
// PATCH /api/notifications  body: { ids: string[] }  → mark as read
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

export async function GET() {
  const userId = await getCurrentUserId();
  const [items, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.notification.count({ where: { userId, read: false } }),
  ]);
  return NextResponse.json({ items, unreadCount });
}

const PatchSchema = z.object({ ids: z.array(z.string()).min(1).max(100) });

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const userId = await getCurrentUserId();
  const result = await db.notification.updateMany({
    where: { userId, id: { in: parsed.data.ids }, read: false },
    data: { read: true, readAt: new Date() },
  });
  return NextResponse.json({ marked: result.count });
}
