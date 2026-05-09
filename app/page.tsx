import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Resolve DB lookup outside the redirect call so preview deploys (no
  // DATABASE_URL) fall through to /today instead of crashing the server
  // render. NB: redirect() throws NEXT_REDIRECT internally — never wrap it
  // in try/catch, the throw must bubble to Next.js.
  let needsOnboarding = false;
  try {
    const userId = await getCurrentUserId();
    const goal = await db.goal.findFirst({
      where: { userId, status: "active" },
      orderBy: { createdAt: "desc" },
    });
    if (!goal) needsOnboarding = true;
  } catch {
    // DB unavailable — skip onboarding check, fall through to /today.
  }

  if (needsOnboarding) redirect("/onboarding");
  redirect("/today");
}
