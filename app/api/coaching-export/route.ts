import { NextResponse } from "next/server";
import { getServiceUserId } from "@/lib/auth/current-user";
import { readCoachingToken } from "@/lib/auth/coaching-token";
import { buildCoachingExport } from "@/lib/coaching-export/build-export";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  if (!readCoachingToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Service caller — no browser session exists on this path.
  const userId = await getServiceUserId();
  const data = await buildCoachingExport(userId);

  return NextResponse.json(data, {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
