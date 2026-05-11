import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleCoachingAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "user-123"),
}));

vi.mock("@/lib/coaching-update/handle-action", () => ({
  handleCoachingAction: mockHandleCoachingAction,
}));

import { POST } from "@/app/api/coaching-update/route";

const TOKEN = "test-token-xyz";

function makeReq(opts: { token?: string; body?: unknown; rawBody?: string }) {
  const url = opts.token
    ? `http://localhost/api/coaching-update?token=${opts.token}`
    : "http://localhost/api/coaching-update";
  return new Request(url, {
    method: "POST",
    body: opts.rawBody !== undefined ? opts.rawBody : JSON.stringify(opts.body ?? {}),
  });
}

describe("POST /api/coaching-update — auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COACHING_EXPORT_TOKEN = TOKEN;
    mockHandleCoachingAction.mockResolvedValue({
      success: true,
      logId: "log-1",
      action: "updateTherapyPhase",
    });
  });

  it("returns 401 without token", async () => {
    const res = await POST(makeReq({ body: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await POST(makeReq({ token: "wrong", body: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when COACHING_EXPORT_TOKEN env var is not set", async () => {
    delete process.env.COACHING_EXPORT_TOKEN;
    const res = await POST(makeReq({ token: TOKEN, body: {} }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/coaching-update — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COACHING_EXPORT_TOKEN = TOKEN;
    mockHandleCoachingAction.mockResolvedValue({
      success: true,
      logId: "log-1",
      action: "updateTherapyPhase",
    });
  });

  it("returns 400 with invalid JSON", async () => {
    const res = await POST(makeReq({ token: TOKEN, rawBody: "not-json{" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 when action is missing", async () => {
    const res = await POST(
      makeReq({ token: TOKEN, body: { data: {}, reason: "test reason" } }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when reason is too short", async () => {
    const res = await POST(
      makeReq({
        token: TOKEN,
        body: { action: "updateTherapyPhase", data: { phase: "REMODELING" }, reason: "x" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when reason is missing", async () => {
    const res = await POST(
      makeReq({
        token: TOKEN,
        body: { action: "updateTherapyPhase", data: { phase: "REMODELING" } },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/coaching-update — action dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COACHING_EXPORT_TOKEN = TOKEN;
  });

  it("forwards a valid request to the handler with the user's id", async () => {
    mockHandleCoachingAction.mockResolvedValue({
      success: true,
      logId: "log-42",
      action: "updateTherapyPhase",
    });
    const res = await POST(
      makeReq({
        token: TOKEN,
        body: {
          action: "updateTherapyPhase",
          data: { phase: "REMODELING" },
          reason: "Q reports no pain in 14 days",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockHandleCoachingAction).toHaveBeenCalledWith(
      "user-123",
      "updateTherapyPhase",
      { phase: "REMODELING" },
      "Q reports no pain in 14 days",
    );
    const body = (await res.json()) as { success: boolean; logId: string; action: string };
    expect(body.success).toBe(true);
    expect(body.logId).toBe("log-42");
    expect(body.action).toBe("updateTherapyPhase");
  });

  it("propagates handler 400 status for unknown actions", async () => {
    mockHandleCoachingAction.mockResolvedValue({
      success: false,
      status: 400,
      error: "unknown_action",
      details: { action: "doSomethingWild" },
    });
    const res = await POST(
      makeReq({
        token: TOKEN,
        body: { action: "doSomethingWild", data: {}, reason: "test" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_action");
  });

  it("propagates handler 400 status for invalid_data", async () => {
    mockHandleCoachingAction.mockResolvedValue({
      success: false,
      status: 400,
      error: "invalid_data",
      details: { fieldErrors: {} },
    });
    const res = await POST(
      makeReq({
        token: TOKEN,
        body: { action: "updateTherapyPhase", data: { phase: "INVALID" }, reason: "test" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("propagates handler 422 for triggerCalibration with insufficient data", async () => {
    mockHandleCoachingAction.mockResolvedValue({
      success: false,
      status: 422,
      error: "insufficient_data",
      details: { message: "not enough TDEE", daysAvailable: 3 },
    });
    const res = await POST(
      makeReq({
        token: TOKEN,
        body: { action: "triggerCalibration", data: {}, reason: "manual trigger" },
      }),
    );
    expect(res.status).toBe(422);
  });

  it("propagates handler 404 when no active meal plan exists", async () => {
    mockHandleCoachingAction.mockResolvedValue({
      success: false,
      status: 404,
      error: "no_active_meal_plan",
    });
    const res = await POST(
      makeReq({
        token: TOKEN,
        body: {
          action: "updateCalorieTargets",
          data: {
            dayType: "rest",
            calorieTarget: 1700,
            proteinG: 190,
            carbsG: 78,
            fatG: 70,
          },
          reason: "manual override before seed",
        },
      }),
    );
    expect(res.status).toBe(404);
  });
});
