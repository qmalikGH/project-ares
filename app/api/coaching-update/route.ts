import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { handleCoachingAction } from "@/lib/coaching-update/handle-action";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RequestBodySchema = z.object({
  action: z.string().min(1).max(80),
  data: z.unknown(),
  reason: z.string().min(3).max(2000),
});

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token || !process.env.COACHING_EXPORT_TOKEN || token !== process.env.COACHING_EXPORT_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  const result = await handleCoachingAction(
    userId,
    parsed.data.action,
    parsed.data.data,
    parsed.data.reason,
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    action: result.action,
    reason: parsed.data.reason,
    logId: result.logId,
  });
}
