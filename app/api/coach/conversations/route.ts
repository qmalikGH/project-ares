// GET /api/coach/conversations
// Lists Free-Chat conversations for the user with id + title + lastMessageAt.
// Title = first user message (truncated).
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

export async function GET() {
  const userId = await getCurrentUserId();
  const rows = await db.aIConversation.findMany({
    where: { userId, type: "free_chat" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      messages: true,
      createdAt: true,
      updatedAt: true,
      tokensInput: true,
      tokensOutput: true,
    },
  });

  const items = rows.map((r) => {
    const messages = (r.messages as Array<{ role: string; content: string }> | null) ?? [];
    const firstUser = messages.find((m) => m.role === "user");
    const title = firstUser
      ? firstUser.content.length > 60
        ? `${firstUser.content.slice(0, 60)}…`
        : firstUser.content
      : "Neue Conversation";
    return {
      id: r.id,
      title,
      messageCount: messages.length,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      tokensInput: r.tokensInput,
      tokensOutput: r.tokensOutput,
    };
  });

  return NextResponse.json({ items });
}
