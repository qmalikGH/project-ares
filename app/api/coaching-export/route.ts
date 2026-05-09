import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { buildCoachingExport } from "@/lib/coaching-export/build-export";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token || !process.env.COACHING_EXPORT_TOKEN || token !== process.env.COACHING_EXPORT_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = await getCurrentUserId();
  const data = await buildCoachingExport(userId);

  return NextResponse.json(data, {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
