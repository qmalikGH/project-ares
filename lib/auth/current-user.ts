// Single-user auth shim for v0.1.
// Project Ares is a personal app for Q. Full NextAuth is deferred to v0.2;
// for now, all routes treat Q as the only logged-in user, identified by env.
//
// To upgrade later: replace getCurrentUserId() with a real session lookup
// (e.g. `auth()` from NextAuth v5).
import { db } from "@/lib/db/client";

const Q_EMAIL = "quentinmalik.career@gmail.com";
const Q_NAME = "Q";

export async function getCurrentUserId(): Promise<string> {
  const existing = await db.user.findUnique({ where: { email: Q_EMAIL } });
  if (existing) return existing.id;
  const created = await db.user.create({
    data: { email: Q_EMAIL, name: Q_NAME },
  });
  return created.id;
}

export async function getCurrentUser() {
  const userId = await getCurrentUserId();
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return user;
}
