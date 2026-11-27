// syncGarminForDate status derivation — Sprint 2.8.
//
// The claim under test: "SUCCESS means the data arrived." Before this sprint it
// meant "five calls did not throw", which is how a SUCCESS row ended up next to
// three NULL calorie columns.
import { beforeEach, describe, expect, it, vi } from "vitest";

const clearSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/garmin/client", () => ({
  getGarminClient: vi.fn(async () => {
    throw new Error("should not be reached — tests inject a client");
  }),
  clearGarminSession: clearSession,
}));

vi.mock("@/lib/date", () => ({
  toUserDateString: (d: Date) => d.toISOString().slice(0, 10),
}));

import { classifyError, syncGarminForDate } from "@/lib/garmin/sync";

const DATE = new Date("2026-08-12T00:00:00.000Z");

/** A client where everything works; individual tests knock pieces out. */
function fakeClient(over: Record<string, unknown> = {}) {
  return {
    getUserProfile: async () => ({ displayName: "q" }),
    getSleepData: async () => ({
      dailySleepDTO: { sleepScores: { overall: { value: 74 } }, sleepTimeSeconds: 22440 },
    }),
    getHeartRate: async () => ({ restingHeartRate: 51 }),
    getActivities: async () => [{}, {}],
    get: async (url: string) => {
      if (url.includes("hrv-service")) {
        return { hrvSummary: { lastNightAvg: 85, status: "BALANCED" } };
      }
      return {
        bodyBatteryAtWakeTime: 48,
        bodyBatteryMostRecentValue: 20,
        totalKilocalories: 2900,
        activeKilocalories: 900,
        bmrKilocalories: 2000,
        averageStressLevel: 33,
      };
    },
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("status derivation", () => {
  it("all six flags → SUCCESS", async () => {
    const r = await syncGarminForDate(DATE, { client: fakeClient() as never });
    expect(r.flags.energySyncOk).toBe(true);
    expect(r.status).toBe("SUCCESS");
  });

  // The regression: a daily summary that answers but carries no calories.
  it("summary without calories → energySyncOk false and PARTIAL, not SUCCESS", async () => {
    const client = fakeClient({
      get: async (url: string) => {
        if (url.includes("hrv-service")) return { hrvSummary: { lastNightAvg: 85, status: "BALANCED" } };
        return { bodyBatteryAtWakeTime: 48, bodyBatteryMostRecentValue: 20 };
      },
    });
    const r = await syncGarminForDate(DATE, { client: client as never });
    expect(r.flags.energySyncOk).toBe(false);
    expect(r.flags.bodyBatterySyncOk).toBe(true);
    expect(r.status).toBe("PARTIAL");
  });

  // Guards the FLAG_COUNT change against a regression to a hardcoded number.
  it("five of six → PARTIAL", async () => {
    const client = fakeClient({ getActivities: async () => { throw new Error("boom"); } });
    const r = await syncGarminForDate(DATE, { client: client as never });
    expect(Object.values(r.flags).filter(Boolean)).toHaveLength(5);
    expect(r.status).toBe("PARTIAL");
  });

  it("a sleep DTO without a score no longer counts as a successful sleep sync", async () => {
    const client = fakeClient({
      getSleepData: async () => ({ dailySleepDTO: { sleepScores: {}, sleepTimeSeconds: 22440 } }),
    });
    const r = await syncGarminForDate(DATE, { client: client as never });
    expect(r.flags.sleepSyncOk).toBe(false);
  });
});

describe("a profile hiccup must not take the energy block with it", () => {
  it("falls back to GARMIN_DISPLAY_NAME", async () => {
    process.env.GARMIN_DISPLAY_NAME = "q-from-env";
    const client = fakeClient({ getUserProfile: async () => { throw new Error("profile 500"); } });
    const r = await syncGarminForDate(DATE, { client: client as never });
    expect(r.flags.energySyncOk).toBe(true);
    delete process.env.GARMIN_DISPLAY_NAME;
  });

  it("without a fallback it reports `profile`, not `body_battery`, and stays PARTIAL", async () => {
    delete process.env.GARMIN_DISPLAY_NAME;
    const client = fakeClient({ getUserProfile: async () => ({}) });
    const r = await syncGarminForDate(DATE, { client: client as never });
    expect(r.errors.map((e) => e.datatype)).toContain("profile");
    expect(r.errors.map((e) => e.datatype)).not.toContain("body_battery");
    expect(r.status).toBe("PARTIAL");
    expect(r.flags.rhrSyncOk).toBe(true);
  });
});

describe("auth handling", () => {
  it("a 403 mid-run marks authFailed and drops the cached session", async () => {
    const client = fakeClient({
      getHeartRate: async () => { throw new Error("ERROR: (403), Forbidden"); },
    });
    const r = await syncGarminForDate(DATE, { client: client as never });
    expect(r.authFailed).toBe(true);
    expect(clearSession).toHaveBeenCalled();
  });

  it("classifyError recognises bare status codes", () => {
    // Was API_CHANGED, so nothing keyed off AUTH_FAILURE would ever fire.
    expect(classifyError("ERROR: (403), Forbidden")).toBe("AUTH_FAILURE");
    expect(classifyError("Request failed with status code 401")).toBe("AUTH_FAILURE");
    expect(classifyError("connection timeout")).toBe("NETWORK");
  });
});

// Review fix (#28, point 2c): the daily sync respects the cron's budget.
describe("deadline", () => {
  it("skips every call that would not fit and says so", async () => {
    const r = await syncGarminForDate(DATE, {
      client: fakeClient() as never,
      deadline: { remainingMs: () => 1_000, isNear: () => true },
    });
    expect(r.status).toBe("FAILURE");
    expect(r.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining(["skipped: time budget"]),
    );
    expect(r.errors.map((e) => e.datatype)).toEqual(
      expect.arrayContaining(["sleep", "rhr", "hrv", "daily_summary", "activities"]),
    );
    expect(classifyError("skipped: time budget")).toBe("TIME_BUDGET");
  });

  it("runs normally with time left", async () => {
    const r = await syncGarminForDate(DATE, {
      client: fakeClient() as never,
      deadline: { remainingMs: () => 50_000, isNear: () => false },
    });
    expect(r.status).toBe("SUCCESS");
  });

  it("a login that timed out is a network problem, not an auth retry", () => {
    expect(classifyError("Garmin timeout after 15000 ms: login")).toBe("NETWORK");
    expect(classifyError("Login failed: invalid credentials")).toBe("AUTH_FAILURE");
  });
});
