// GET /api/coach/conversations/[id] — full message log of one conversation.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const userId = await getCurrentUserId();
  const row = await db.aIConversation.findFirst({
    where: { id, userId, type: "free_chat" },
    select: {
      id: true,
      messages: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    id: row.id,
    messages: (row.messages as Array<{ role: string; content: string }> | null) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
