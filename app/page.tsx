import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await getCurrentUserId();
  const goal = await db.goal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  if (!goal) redirect("/onboarding");
  redirect("/today");
}
