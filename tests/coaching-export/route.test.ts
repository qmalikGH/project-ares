import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted ensures the variable is available when vi.mock factory runs (hoisting).
const mockBuildCoachingExport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "user-123"),
}));

vi.mock("@/lib/coaching-export/build-export", () => ({
  buildCoachingExport: mockBuildCoachingExport,
}));

import { GET } from "@/app/api/coaching-export/route";

const CORRECT_TOKEN = "test-token-abc123";

const STUB_EXPORT = {
  exportedAt: "2026-05-09T10:00:00.000Z",
  periodization: null,
  performanceMarkers: null,
  trainingHistory: {
    last28Days: { planned: 2, completed: 6, skipped: 2, complianceRate: 60 },
    sessions: [],
    volumeTrends: { weeklyRunKm: [], weeklyStrengthSets: [] },
  },
  wellness: { days: [], baselines: null },
  health: {
    therapyPhase: "REMODELING",
    activeInjuries: [],
    painHistory: [],
    preventionExercises: [],
  },
  upcoming: { sessions: [] },
  athlete: {
    weightKg: null,
    targetWeightKg: null,
    timezone: null,
    restDays: ["Wednesday", "Sunday"],
    preferredLongRunDay: "Saturday",
    therapyPhase: null,
  },
};

describe("GET /api/coaching-export — auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COACHING_EXPORT_TOKEN = CORRECT_TOKEN;
    mockBuildCoachingExport.mockResolvedValue(STUB_EXPORT);
  });

  it("returns 401 when no token is provided", async () => {
    const req = new Request("http://localhost/api/coaching-export");
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when wrong token is provided", async () => {
    const req = new Request("http://localhost/api/coaching-export?token=wrong-token");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when COACHING_EXPORT_TOKEN env var is not set", async () => {
    delete process.env.COACHING_EXPORT_TOKEN;
    const req = new Request(`http://localhost/api/coaching-export?token=${CORRECT_TOKEN}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct token", async () => {
    const req = new Request(`http://localhost/api/coaching-export?token=${CORRECT_TOKEN}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/coaching-export — response shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COACHING_EXPORT_TOKEN = CORRECT_TOKEN;
    mockBuildCoachingExport.mockResolvedValue(STUB_EXPORT);
  });

  it("response has all required top-level keys", async () => {
    const req = new Request(`http://localhost/api/coaching-export?token=${CORRECT_TOKEN}`);
    const res = await GET(req);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of [
      "exportedAt",
      "periodization",
      "performanceMarkers",
      "trainingHistory",
      "wellness",
      "health",
      "upcoming",
      "athlete",
    ]) {
      expect(body, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it("calls buildCoachingExport with the resolved userId", async () => {
    const req = new Request(`http://localhost/api/coaching-export?token=${CORRECT_TOKEN}`);
    await GET(req);
    expect(mockBuildCoachingExport).toHaveBeenCalledWith("user-123");
  });

  it("includes Cache-Control: no-store header", async () => {
    const req = new Request(`http://localhost/api/coaching-export?token=${CORRECT_TOKEN}`);
    const res = await GET(req);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("wellness.days is empty when builder returns empty", async () => {
    const req = new Request(`http://localhost/api/coaching-export?token=${CORRECT_TOKEN}`);
    const res = await GET(req);
    const body = (await res.json()) as typeof STUB_EXPORT;
    expect(body.wellness.days).toEqual([]);
  });
});
