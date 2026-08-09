// Shared-secret check for the external AI coach (Sprint 2.5).
//
// The token used to be read from a QUERY PARAMETER, which puts it into Vercel
// access logs, browser history and any Referer header. It now belongs in
// `Authorization: Bearer <token>`.
//
// The query parameter is still accepted so the coach integration keeps working
// across the switch — it is DEPRECATED and should be removed once the external
// config is updated. Until then the leak persists on that path only.
export function readCoachingToken(req: Request): boolean {
  const expected = process.env.COACHING_EXPORT_TOKEN;
  if (!expected) return false;

  const header = req.headers.get("authorization");
  if (header === `Bearer ${expected}`) return true;

  // DEPRECATED path — remove once the external coach sends the header.
  const legacy = new URL(req.url).searchParams.get("token");
  if (legacy && legacy === expected) {
    console.warn(
      "[coaching-token] token supplied via query parameter (deprecated — use Authorization: Bearer)",
    );
    return true;
  }

  return false;
}
