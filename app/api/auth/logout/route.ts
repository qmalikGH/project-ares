// POST /api/auth/logout — clears the session cookie (Sprint 2.5).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return NextResponse.json({ status: "ok" });
}
