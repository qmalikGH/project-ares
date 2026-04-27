// Garmin Connect client wrapper.
// Uses the unofficial garmin-connect npm library; per spec section 9, this is
// the riskiest external dependency in the project. We isolate the wire here so
// breakage in the library doesn't bleed into the engine.
import { GarminConnect } from "garmin-connect";

let cached: { client: GarminConnect; loggedInAt: number } | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000; // re-login every 30 minutes max

function readGarminCredentials(): { username: string; password: string } {
  // .env.local is shadowed by an empty shell var in some environments
  // (see lib/ai-coach/client.ts). Re-read the file as a fallback.
  let username = process.env.GARMIN_USERNAME ?? "";
  let password = process.env.GARMIN_PASSWORD ?? "";

  if (!username || !password) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path") as typeof import("node:path");
      const envPath = path.resolve(process.cwd(), ".env.local");
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
        for (const line of lines) {
          const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"\r\n]+)"?$/);
          if (!m) continue;
          if (m[1] === "GARMIN_USERNAME" && !username) username = m[2];
          if (m[1] === "GARMIN_PASSWORD" && !password) password = m[2];
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!username || !password) {
    throw new Error("GARMIN_USERNAME / GARMIN_PASSWORD not set in environment");
  }
  return { username, password };
}

/**
 * Lazy GarminConnect singleton. Re-authenticates after SESSION_TTL_MS.
 * Garmin throttles aggressive logins, so reusing the session matters.
 */
export async function getGarminClient(): Promise<GarminConnect> {
  const now = Date.now();
  if (cached && now - cached.loggedInAt < SESSION_TTL_MS) {
    return cached.client;
  }
  const { username, password } = readGarminCredentials();
  const client = new GarminConnect({ username, password });
  await client.login(username, password);
  cached = { client, loggedInAt: now };
  return client;
}

export function clearGarminSession() {
  cached = null;
}
