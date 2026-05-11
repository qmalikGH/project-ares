import { beforeEach, describe, expect, it, vi } from "vitest";

const userSettingsUpsert = vi.hoisted(() => vi.fn());
const coachingLogCreate = vi.hoisted(() => vi.fn());
const mealPlanFindFirst = vi.hoisted(() => vi.fn());
const mealPlanCreate = vi.hoisted(() => vi.fn());
const dayPlanFindUnique = vi.hoisted(() => vi.fn());
const dayPlanFindMany = vi.hoisted(() => vi.fn());
const dayPlanCreate = vi.hoisted(() => vi.fn());
const dayPlanUpdate = vi.hoisted(() => vi.fn());
const dayPlanUpdateMany = vi.hoisted(() => vi.fn());
const dailyNutritionLogFindUnique = vi.hoisted(() => vi.fn());
const dailyNutritionLogUpdate = vi.hoisted(() => vi.fn());
const dailyNutritionLogCreate = vi.hoisted(() => vi.fn());
const calibrateMealPlanMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    userSettings: { upsert: userSettingsUpsert },
    coachingLog: { create: coachingLogCreate },
    mealPlan: { findFirst: mealPlanFindFirst, create: mealPlanCreate },
    dayPlan: {
      findUnique: dayPlanFindUnique,
      findMany: dayPlanFindMany,
      create: dayPlanCreate,
      update: dayPlanUpdate,
      updateMany: dayPlanUpdateMany,
    },
    dailyNutritionLog: {
      findUnique: dailyNutritionLogFindUnique,
      update: dailyNutritionLogUpdate,
      create: dailyNutritionLogCreate,
    },
  },
}));

vi.mock("@/lib/db/queries/sensors", () => ({
  dayKey: (d: Date) => {
    const r = new Date(d);
    r.setUTCHours(0, 0, 0, 0);
    return r;
  },
}));

vi.mock("@/lib/nutrition/calibration", () => ({
  calibrateMealPlan: calibrateMealPlanMock,
}));

import { handleCoachingAction } from "@/lib/coaching-update/handle-action";

const USER_ID = "user-123";

describe("handleCoachingAction — guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSettingsUpsert.mockResolvedValue({});
    coachingLogCreate.mockResolvedValue({ id: "log-1" });
  });

  it("rejects empty reason", async () => {
    const result = await handleCoachingAction(USER_ID, "updateTherapyPhase", { phase: "REMODELING" }, "");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("reason_required");
    expect(userSettingsUpsert).not.toHaveBeenCalled();
  });

  it("rejects too-short reason", async () => {
    const result = await handleCoachingAction(USER_ID, "updateTherapyPhase", { phase: "REMODELING" }, "ab");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("reason_required");
  });

  it("rejects unknown action", async () => {
    const result = await handleCoachingAction(USER_ID, "weird_action", {}, "valid reason text");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("unknown_action");
      expect(result.status).toBe(400);
    }
  });

  it("nutrition actions are now implemented (Phase B9)", async () => {
    // updateMealPlan validates first — invalid data returns 400 invalid_data
    const result = await handleCoachingAction(USER_ID, "updateMealPlan", {}, "future test");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("invalid_data");
      expect(result.status).toBe(400);
    }
  });
});

describe("handleCoachingAction — updateTherapyPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSettingsUpsert.mockResolvedValue({});
    coachingLogCreate.mockResolvedValue({ id: "log-therapy" });
  });

  it("upserts therapyPhaseOverride for valid phase", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateTherapyPhase",
      { phase: "REMODELING" },
      "Q reports no pain after 14 days",
    );
    expect(result.success).toBe(true);
    expect(userSettingsUpsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      update: { therapyPhaseOverride: "REMODELING" },
      create: { userId: USER_ID, therapyPhaseOverride: "REMODELING" },
    });
    expect(coachingLogCreate).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        action: "updateTherapyPhase",
        data: { phase: "REMODELING" },
        reason: "Q reports no pain after 14 days",
      },
    });
  });

  it("rejects invalid phase value", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateTherapyPhase",
      { phase: "INVALID_PHASE" },
      "test reason",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("invalid_data");
    expect(userSettingsUpsert).not.toHaveBeenCalled();
    expect(coachingLogCreate).not.toHaveBeenCalled();
  });

  it("accepts all 4 valid phase values", async () => {
    for (const phase of ["REACTIVE", "DISREPAIR", "REMODELING", "SPORT_SPECIFIC"]) {
      vi.clearAllMocks();
      userSettingsUpsert.mockResolvedValue({});
      coachingLogCreate.mockResolvedValue({ id: `log-${phase}` });
      const r = await handleCoachingAction(USER_ID, "updateTherapyPhase", { phase }, "test reason");
      expect(r.success, `phase ${phase} should be accepted`).toBe(true);
    }
  });
});

describe("handleCoachingAction — updateActiveInjuries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSettingsUpsert.mockResolvedValue({});
    coachingLogCreate.mockResolvedValue({ id: "log-inj" });
  });

  it("upserts injuries array", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateActiveInjuries",
      { injuries: ["shin_splints"] },
      "Diagnosis updated by physiotherapist",
    );
    expect(result.success).toBe(true);
    expect(userSettingsUpsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      update: { activeInjuries: ["shin_splints"] },
      create: { userId: USER_ID, activeInjuries: ["shin_splints"] },
    });
  });

  it("accepts empty array (no active injuries)", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateActiveInjuries",
      { injuries: [] },
      "All injuries resolved",
    );
    expect(result.success).toBe(true);
  });

  it("rejects non-array data", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateActiveInjuries",
      { injuries: "shin_splints" },
      "test",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("invalid_data");
  });
});

describe("handleCoachingAction — updatePreventionExercises", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSettingsUpsert.mockResolvedValue({});
    coachingLogCreate.mockResolvedValue({ id: "log-prev" });
  });

  it("upserts exercise list", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updatePreventionExercises",
      {
        exercises: ["Tibialis Anterior Raises", "Short Foot Exercise", "Single-Leg Calf Raises"],
      },
      "Switching to shin-splint prevention protocol",
    );
    expect(result.success).toBe(true);
    expect(userSettingsUpsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      update: {
        preventionExercises: [
          "Tibialis Anterior Raises",
          "Short Foot Exercise",
          "Single-Leg Calf Raises",
        ],
      },
      create: {
        userId: USER_ID,
        preventionExercises: [
          "Tibialis Anterior Raises",
          "Short Foot Exercise",
          "Single-Leg Calf Raises",
        ],
      },
    });
  });
});

describe("handleCoachingAction — updateMealPlan (Phase B9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coachingLogCreate.mockResolvedValue({ id: "log-meal" });
    mealPlanFindFirst.mockResolvedValue({ id: "plan-1" });
    dayPlanFindUnique.mockResolvedValue({
      id: "dayplan-1",
      slots: { mainMeal: { items: [] } },
    });
    dayPlanUpdate.mockResolvedValue({});
  });

  it("patches a single slot on the active DayPlan", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateMealPlan",
      {
        dayType: "strength_run",
        slot: "morning",
        items: [{ name: "Test Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, costEur: 1.87 }],
      },
      "Coach swaps morning bar",
    );
    expect(result.success).toBe(true);
    expect(dayPlanUpdate).toHaveBeenCalled();
  });

  it("returns 404 when no active meal plan exists", async () => {
    mealPlanFindFirst.mockResolvedValue(null);
    const result = await handleCoachingAction(
      USER_ID,
      "updateMealPlan",
      {
        dayType: "strength_run",
        slot: "morning",
        items: [],
      },
      "no plan yet",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("no_active_meal_plan");
      expect(result.status).toBe(404);
    }
  });

  it("rejects invalid dayType", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateMealPlan",
      { dayType: "INVALID", slot: "morning", items: [] },
      "test",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("invalid_data");
  });
});

describe("handleCoachingAction — updateCalorieTargets (Phase B9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coachingLogCreate.mockResolvedValue({ id: "log-cal" });
    mealPlanFindFirst.mockResolvedValue({ id: "plan-1", deficitKcal: 500 });
    dayPlanFindMany.mockResolvedValue([{ id: "dp-rest-1" }]);
    dayPlanUpdate.mockResolvedValue({});
  });

  it("updates DayPlan macros + slots for the given dayType", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "updateCalorieTargets",
      {
        dayType: "rest",
        calorieTarget: 1700,
        proteinG: 190,
        carbsG: 78,
        fatG: 70,
      },
      "Switching rest day target post-calibration",
    );
    expect(result.success).toBe(true);
    // Slot cascade: now uses findMany + individual update instead of updateMany
    expect(dayPlanFindMany).toHaveBeenCalledWith({
      where: { mealPlanId: "plan-1", dayType: "rest" },
      select: { id: true },
    });
    expect(dayPlanUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dp-rest-1" },
        data: expect.objectContaining({
          calorieTarget: 1700,
          proteinG: 190,
          carbsG: 78,
          fatG: 70,
          slots: expect.any(Object),
        }),
      }),
    );
  });

  it("returns 404 when DayPlan does not exist", async () => {
    dayPlanFindMany.mockResolvedValue([]);
    const result = await handleCoachingAction(
      USER_ID,
      "updateCalorieTargets",
      { dayType: "rest", calorieTarget: 1700, proteinG: 190, carbsG: 78, fatG: 70 },
      "test",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("day_plan_not_found");
  });
});

describe("handleCoachingAction — triggerCalibration (Phase B9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coachingLogCreate.mockResolvedValue({ id: "log-cal-trig" });
  });

  it("returns success when calibration succeeds", async () => {
    calibrateMealPlanMock.mockResolvedValue({
      status: "calibrated",
      averages: { strength_run: 3050, threshold: 2800, long_run: 3200, rest: 2200 },
      daysAvailable: 14,
      message: "ok",
    });
    const result = await handleCoachingAction(USER_ID, "triggerCalibration", {}, "manual recalibration");
    expect(result.success).toBe(true);
    expect(calibrateMealPlanMock).toHaveBeenCalledWith(USER_ID);
  });

  it("returns 422 insufficient_data when calibration cannot run", async () => {
    calibrateMealPlanMock.mockResolvedValue({
      status: "insufficient_data",
      averages: {},
      daysAvailable: 2,
      message: "Not enough data",
    });
    const result = await handleCoachingAction(USER_ID, "triggerCalibration", {}, "test");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("insufficient_data");
      expect(result.status).toBe(422);
    }
  });
});

describe("handleCoachingAction — adjustDaySlot (Phase B9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coachingLogCreate.mockResolvedValue({ id: "log-adj" });
    dailyNutritionLogFindUnique.mockResolvedValue(null);
    dailyNutritionLogCreate.mockResolvedValue({ id: "nlog-1" });
    dailyNutritionLogUpdate.mockResolvedValue({});
  });

  it("creates a DailyNutritionLog when none exists", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "adjustDaySlot",
      { date: "2026-05-09", slot: "postMealDessert", action: "remove" },
      "Q already had cake — skip Skyr",
    );
    expect(result.success).toBe(true);
    expect(dailyNutritionLogCreate).toHaveBeenCalled();
  });

  it("updates the existing log when one is present", async () => {
    dailyNutritionLogFindUnique.mockResolvedValue({ id: "nlog-existing" });
    const result = await handleCoachingAction(
      USER_ID,
      "adjustDaySlot",
      { date: "2026-05-09", slot: "postMealDessert", action: "remove" },
      "test",
    );
    expect(result.success).toBe(true);
    expect(dailyNutritionLogUpdate).toHaveBeenCalled();
    expect(dailyNutritionLogCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed date strings", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "adjustDaySlot",
      { date: "not-a-date", slot: "postMealDessert", action: "remove" },
      "test",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("invalid_data");
  });
});

describe("handleCoachingAction — seedMealPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coachingLogCreate.mockResolvedValue({ id: "log-seed" });
    mealPlanCreate.mockResolvedValue({ id: "new-plan-id" });
    dayPlanCreate.mockImplementation(async ({ data }: { data: { dayType: string } }) => ({
      id: `dp-${data.dayType}`,
    }));
  });

  it("creates a MealPlan + 4 DayPlans when none exists", async () => {
    mealPlanFindFirst.mockResolvedValue(null);
    const result = await handleCoachingAction(USER_ID, "seedMealPlan", {}, "Initial Block 1 seed");
    expect(result.success).toBe(true);
    expect(mealPlanCreate).toHaveBeenCalledTimes(1);
    expect(dayPlanCreate).toHaveBeenCalledTimes(4);
    expect(coachingLogCreate).toHaveBeenCalledTimes(1);
  });

  it("seeds Block 1 Standard with the canonical defaults", async () => {
    mealPlanFindFirst.mockResolvedValue(null);
    await handleCoachingAction(USER_ID, "seedMealPlan", {}, "Initial Block 1 seed");
    expect(mealPlanCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        name: "Block 1 Standard",
        status: "active",
        budgetPerDay: 15.0,
        proteinTarget: 190,
        deficitKcal: 500,
        calibrationStatus: "pending",
      }),
    });
  });

  it("creates one DayPlan per day-type", async () => {
    mealPlanFindFirst.mockResolvedValue(null);
    await handleCoachingAction(USER_ID, "seedMealPlan", {}, "test");
    const seededTypes = dayPlanCreate.mock.calls.map((c) => (c[0] as { data: { dayType: string } }).data.dayType);
    expect(seededTypes.sort()).toEqual(["long_run", "rest", "strength_run", "threshold"]);
  });

  it("returns 409 when an active MealPlan already exists", async () => {
    mealPlanFindFirst.mockResolvedValue({ id: "existing-plan", name: "Block 1 Standard" });
    const result = await handleCoachingAction(USER_ID, "seedMealPlan", {}, "Try again");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("MealPlan already exists");
      expect(result.status).toBe(409);
    }
    expect(mealPlanCreate).not.toHaveBeenCalled();
    expect(dayPlanCreate).not.toHaveBeenCalled();
  });

  it("does not write a CoachingLog when an active plan blocks the seed", async () => {
    mealPlanFindFirst.mockResolvedValue({ id: "existing-plan", name: "X" });
    await handleCoachingAction(USER_ID, "seedMealPlan", {}, "no-op");
    expect(coachingLogCreate).not.toHaveBeenCalled();
  });
});

describe("handleCoachingAction — CoachingLog audit trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSettingsUpsert.mockResolvedValue({});
    coachingLogCreate.mockResolvedValue({ id: "log-audit" });
  });

  it("writes a CoachingLog entry on every successful action", async () => {
    await handleCoachingAction(
      USER_ID,
      "updateTherapyPhase",
      { phase: "DISREPAIR" },
      "Pain flare-up reported",
    );
    expect(coachingLogCreate).toHaveBeenCalledTimes(1);
    expect(coachingLogCreate).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        action: "updateTherapyPhase",
        data: { phase: "DISREPAIR" },
        reason: "Pain flare-up reported",
      },
    });
  });

  it("does NOT write a CoachingLog when validation fails", async () => {
    await handleCoachingAction(
      USER_ID,
      "updateTherapyPhase",
      { phase: "BAD" },
      "test reason",
    );
    expect(coachingLogCreate).not.toHaveBeenCalled();
  });
});
