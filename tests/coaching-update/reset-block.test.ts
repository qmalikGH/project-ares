// Sprint v1.5 — resetBlock action tests.
//
// Validates the post-illness Block-Reset flow: find active macrocycle +
// current Phase, delete future WeeklyPlan rows, create 4 fresh W1-W4 rows
// (first row with loadOverrideWeek=2 when loadPreset="W2"), and extend the
// Phase/Macrocycle dates accordingly.

import { beforeEach, describe, expect, it, vi } from "vitest";

const coachingLogCreate = vi.hoisted(() => vi.fn());
const macrocycleFindFirst = vi.hoisted(() => vi.fn());
const macrocycleUpdate = vi.hoisted(() => vi.fn());
const phaseUpdate = vi.hoisted(() => vi.fn());
const weeklyPlanDeleteMany = vi.hoisted(() => vi.fn());
const weeklyPlanCreateMany = vi.hoisted(() => vi.fn());
const weeklyPlanFindMany = vi.hoisted(() => vi.fn());
const weeklyPlanUpdate = vi.hoisted(() => vi.fn());
const weeklyPlanCount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    coachingLog: { create: coachingLogCreate },
    macrocycle: { findFirst: macrocycleFindFirst, update: macrocycleUpdate },
    phase: { update: phaseUpdate },
    weeklyPlan: {
      deleteMany: weeklyPlanDeleteMany,
      createMany: weeklyPlanCreateMany,
      findMany: weeklyPlanFindMany,
      update: weeklyPlanUpdate,
      count: weeklyPlanCount,
    },
    // Sprint v1.6: materializeWorkouts() is now called inside resetCurrentBlock.
    workout: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) => ({ id: `wk-${Date.now()}`, ...data })),
      update: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // Other handlers are out of scope for this test but coaching-update
    // pulls these — leave them as silent vi.fn() so the import doesn't fail.
    userSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    mealPlan: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    dayPlan: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    dailyNutritionLog: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    dayTypeConfig: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    computedMealSlot: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// "today" is pinned for determinism, but exposed as a mock so the layoff
// scenario below can move it into a later Block.
const DEFAULT_TODAY = new Date("2026-05-21T00:00:00.000Z");
const userTodayMock = vi.hoisted(() =>
  vi.fn(() => new Date("2026-05-21T00:00:00.000Z")),
);

vi.mock("@/lib/date", async () => {
  const actual = await vi.importActual<typeof import("@/lib/date")>("@/lib/date");
  return { ...actual, userToday: userTodayMock };
});

import { handleCoachingAction } from "@/lib/coaching-update/handle-action";

const USER_ID = "user-1";
const MACRO_ID = "macro-1";
const PHASE_1_ID = "phase-1";
const PHASE_2_ID = "phase-2";

const macroFixture = {
  id: MACRO_ID,
  userId: USER_ID,
  totalWeeks: 20,
  endDate: new Date("2026-09-13T00:00:00.000Z"),
  phases: [
    {
      id: PHASE_1_ID,
      macrocycleId: MACRO_ID,
      blockNumber: 1,
      startDate: new Date("2026-04-27T00:00:00.000Z"),
      plannedEndDate: new Date("2026-05-25T00:00:00.000Z"),
      durationWeeks: 4,
      status: "active",
    },
    {
      id: PHASE_2_ID,
      macrocycleId: MACRO_ID,
      blockNumber: 2,
      startDate: new Date("2026-05-25T00:00:00.000Z"),
      plannedEndDate: new Date("2026-06-22T00:00:00.000Z"),
      durationWeeks: 4,
      status: "active",
    },
  ],
};

describe("handleCoachingAction — resetBlock (Sprint v1.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userTodayMock.mockReturnValue(DEFAULT_TODAY);
    coachingLogCreate.mockResolvedValue({ id: "log-1" });
    macrocycleFindFirst.mockResolvedValue(macroFixture);
    macrocycleUpdate.mockResolvedValue({});
    phaseUpdate.mockResolvedValue({});
    weeklyPlanDeleteMany.mockResolvedValue({ count: 2 });
    weeklyPlanCreateMany.mockResolvedValue({ count: 4 });
    weeklyPlanFindMany.mockResolvedValue([]); // No subsequent-phase rows in mocked fixture
    weeklyPlanUpdate.mockResolvedValue({});
    weeklyPlanCount.mockResolvedValue(2);
  });

  it("returns 404 when no active macrocycle exists", async () => {
    macrocycleFindFirst.mockResolvedValue(null);
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { loadPreset: "W2" },
      "test no macro",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("no_active_macrocycle");
  });

  it("deletes future WeeklyPlan rows for the current Phase (from next Monday)", async () => {
    await handleCoachingAction(USER_ID, "resetBlock", { loadPreset: "W2" }, "post-illness reset");
    // 2026-05-21 is Thursday → next Monday = 2026-05-25
    expect(weeklyPlanDeleteMany).toHaveBeenCalledWith({
      where: {
        phaseId: PHASE_1_ID,
        startDate: { gte: new Date("2026-05-25T00:00:00.000Z") },
      },
    });
  });

  it("creates 4 new WeeklyPlan rows with first row having loadOverrideWeek=2 when loadPreset=W2", async () => {
    await handleCoachingAction(USER_ID, "resetBlock", { loadPreset: "W2" }, "post-illness reset");
    expect(weeklyPlanCreateMany).toHaveBeenCalledTimes(1);
    const arg = weeklyPlanCreateMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(4);
    expect(arg.data[0].loadOverrideWeek).toBe(2);
    expect(arg.data[1].loadOverrideWeek).toBe(null);
    expect(arg.data[2].loadOverrideWeek).toBe(null);
    expect(arg.data[3].loadOverrideWeek).toBe(null);
    // First row starts on next Monday
    expect(arg.data[0].startDate.toISOString()).toBe("2026-05-25T00:00:00.000Z");
    // Each row spans 1 week
    expect(arg.data[1].startDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("first row has loadOverrideWeek=null when loadPreset=W1", async () => {
    await handleCoachingAction(USER_ID, "resetBlock", { loadPreset: "W1" }, "fresh start");
    const arg = weeklyPlanCreateMany.mock.calls[0][0];
    expect(arg.data[0].loadOverrideWeek).toBe(null);
  });

  it("writes a CoachingLog entry with reason + details", async () => {
    await handleCoachingAction(USER_ID, "resetBlock", { loadPreset: "W2" }, "post-illness reset");
    expect(coachingLogCreate).toHaveBeenCalledTimes(1);
    const call = coachingLogCreate.mock.calls[0][0];
    expect(call.data.action).toBe("resetBlock");
    expect(call.data.reason).toBe("post-illness reset");
    expect(call.data.data.loadPreset).toBe("W2");
    expect(call.data.data.deletedRows).toBe(2);
    expect(call.data.data.createdRows).toBe(4);
    expect(call.data.data.blockNumber).toBe(1);
  });

  it("rejects invalid loadPreset value", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { loadPreset: "W7" },
      "test",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("invalid_data");
  });

  it("defaults loadPreset to W2 when omitted", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      {},
      "default test",
    );
    expect(result.success).toBe(true);
    const arg = weeklyPlanCreateMany.mock.calls[0][0];
    expect(arg.data[0].loadOverrideWeek).toBe(2); // W2 default
  });

  it("shifts subsequent phases + their WeeklyPlan rows by the weeks-added delta", async () => {
    // Old Phase 1 ends May 25. New end = nextMonday(May 25) + 4 weeks = June 22.
    // Delta = 4 weeks.
    // Phase 2 (originally May 25 → June 22) should slide to June 22 → July 20.
    weeklyPlanFindMany.mockResolvedValue([
      {
        id: "wp-phase2-w1",
        startDate: new Date("2026-05-25T00:00:00.000Z"),
        endDate: new Date("2026-06-01T00:00:00.000Z"),
      },
    ]);

    await handleCoachingAction(USER_ID, "resetBlock", { loadPreset: "W2" }, "shift check");

    // Phase 2 startDate + plannedEndDate shifted by 4 weeks
    const phaseShiftCall = phaseUpdate.mock.calls.find(
      (c) => c[0].where.id === PHASE_2_ID,
    );
    expect(phaseShiftCall).toBeDefined();
    expect(phaseShiftCall![0].data.startDate.toISOString()).toBe(
      "2026-06-22T00:00:00.000Z",
    );
    expect(phaseShiftCall![0].data.plannedEndDate.toISOString()).toBe(
      "2026-07-20T00:00:00.000Z",
    );

    // WeeklyPlan in Phase 2 shifted by 4 weeks
    const wpShiftCall = weeklyPlanUpdate.mock.calls.find(
      (c) => c[0].where.id === "wp-phase2-w1",
    );
    expect(wpShiftCall).toBeDefined();
    expect(wpShiftCall![0].data.startDate.toISOString()).toBe(
      "2026-06-22T00:00:00.000Z",
    );

    // Macrocycle endDate + totalWeeks bumped
    expect(macrocycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endDate: new Date("2026-10-11T00:00:00.000Z"), // Sep 13 + 4 weeks
          totalWeeks: 24, // 20 + 4
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Long-layoff scenario: the calendar has advanced past the Block the athlete
// wants to resume from, so the reset must target a Block explicitly instead
// of whichever one contains today.
// ═══════════════════════════════════════════════════════════════════════════

const PHASE_3_ID = "phase-3";

// Today sits inside Block 3, but Block 2 is the one to re-run.
const LAYOFF_TODAY = new Date("2026-08-04T00:00:00.000Z"); // Tuesday
const LAYOFF_NEXT_MONDAY = new Date("2026-08-10T00:00:00.000Z");

const layoffMacro = {
  id: MACRO_ID,
  userId: USER_ID,
  totalWeeks: 20,
  endDate: new Date("2026-09-13T00:00:00.000Z"),
  phases: [
    {
      id: PHASE_1_ID,
      macrocycleId: MACRO_ID,
      blockNumber: 1,
      startDate: new Date("2026-05-25T00:00:00.000Z"),
      plannedEndDate: new Date("2026-06-22T00:00:00.000Z"),
      durationWeeks: 4,
      status: "completed",
      actualEndDate: new Date("2026-06-22T00:00:00.000Z"),
      blockReviewId: "review-1",
    },
    {
      id: PHASE_2_ID,
      macrocycleId: MACRO_ID,
      blockNumber: 2,
      startDate: new Date("2026-06-22T00:00:00.000Z"),
      plannedEndDate: new Date("2026-07-20T00:00:00.000Z"),
      durationWeeks: 4,
      status: "completed",
      actualEndDate: new Date("2026-07-20T00:00:00.000Z"),
      blockReviewId: "review-2",
    },
    {
      id: PHASE_3_ID,
      macrocycleId: MACRO_ID,
      blockNumber: 3,
      startDate: new Date("2026-07-20T00:00:00.000Z"),
      plannedEndDate: new Date("2026-08-17T00:00:00.000Z"),
      durationWeeks: 4,
      status: "active",
      actualEndDate: null,
      blockReviewId: null,
    },
  ],
};

describe("resetBlock — explicit target block after a long layoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userTodayMock.mockReturnValue(LAYOFF_TODAY);
    coachingLogCreate.mockResolvedValue({ id: "log-1" });
    macrocycleFindFirst.mockResolvedValue(layoffMacro);
    macrocycleUpdate.mockResolvedValue({});
    phaseUpdate.mockResolvedValue({});
    weeklyPlanDeleteMany.mockResolvedValue({ count: 4 });
    weeklyPlanCreateMany.mockResolvedValue({ count: 4 });
    weeklyPlanFindMany.mockResolvedValue([]);
    weeklyPlanUpdate.mockResolvedValue({});
    weeklyPlanCount.mockResolvedValue(4);
  });

  it("without a target, resets the block containing today (Block 3)", async () => {
    await handleCoachingAction(USER_ID, "resetBlock", { loadPreset: "W2" }, "no target");
    expect(weeklyPlanDeleteMany.mock.calls[0][0].where.phaseId).toBe(PHASE_3_ID);
  });

  it("with targetBlockNumber=2, resets Block 2 instead of the current one", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { loadPreset: "W2", targetBlockNumber: 2 },
      "resume from block 2",
    );
    expect(result.success).toBe(true);
    expect(weeklyPlanDeleteMany.mock.calls[0][0].where.phaseId).toBe(PHASE_2_ID);
    expect(coachingLogCreate.mock.calls[0][0].data.data.blockNumber).toBe(2);
  });

  it("deletes ALL WeeklyPlan rows of a past target block, not just from next Monday", async () => {
    // Block 2 lies entirely in the past, so the next-Monday cut-off would
    // match nothing and strand the old rows alongside the new ones.
    await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 2 },
      "past block",
    );
    expect(weeklyPlanDeleteMany).toHaveBeenCalledWith({
      where: {
        phaseId: PHASE_2_ID,
        startDate: { gte: layoffMacro.phases[1].startDate },
      },
    });
  });

  it("keeps the next-Monday boundary when the target block contains today", async () => {
    await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 3 },
      "current block by number",
    );
    expect(weeklyPlanDeleteMany).toHaveBeenCalledWith({
      where: { phaseId: PHASE_3_ID, startDate: { gte: LAYOFF_NEXT_MONDAY } },
    });
  });

  it("creates the fresh weeks from next Monday with the W2 load override", async () => {
    await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { loadPreset: "W2", targetBlockNumber: 2 },
      "resume",
    );
    const arg = weeklyPlanCreateMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(4);
    expect(arg.data[0].startDate.toISOString()).toBe(LAYOFF_NEXT_MONDAY.toISOString());
    expect(arg.data[0].loadOverrideWeek).toBe(2);
    expect(arg.data[0].phaseId).toBe(PHASE_2_ID);
  });

  it("clears completion markers on the reset block so it is not treated as finished", async () => {
    await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 2 },
      "resume",
    );
    const call = phaseUpdate.mock.calls.find((c) => c[0].where.id === PHASE_2_ID);
    expect(call).toBeDefined();
    expect(call![0].data.status).toBe("active");
    expect(call![0].data.actualEndDate).toBeNull();
    expect(call![0].data.blockReviewId).toBeNull();
  });

  it("slides Block 3 past the new Block 2 window instead of overlapping it", async () => {
    await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 2 },
      "resume",
    );
    // New Block 2 runs Aug 10 → Sep 7. Old Block 2 ended Jul 20, so the delta
    // is 7 weeks; Block 3 (Jul 20 → Aug 17) must land on Sep 7 → Oct 5.
    const call = phaseUpdate.mock.calls.find((c) => c[0].where.id === PHASE_3_ID);
    expect(call).toBeDefined();
    expect(call![0].data.startDate.toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(call![0].data.plannedEndDate.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("reports which block reviews were detached", async () => {
    await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 2 },
      "resume",
    );
    // Block 2 had review-2; Block 1 is untouched (earlier block, keeps its review).
    expect(coachingLogCreate.mock.calls[0][0].data.data.clearedBlockReviews).toEqual([2]);
  });

  it("returns 404 for a block number that does not exist", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 5 },
      "missing",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("target_block_not_found");
  });

  it("rejects an out-of-range target block number", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 0 },
      "invalid",
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("invalid_data");
  });

  it("dryRun writes nothing at all", async () => {
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 2, dryRun: true },
      "preview",
    );
    expect(result.success).toBe(true);
    expect(weeklyPlanDeleteMany).not.toHaveBeenCalled();
    expect(weeklyPlanCreateMany).not.toHaveBeenCalled();
    expect(weeklyPlanUpdate).not.toHaveBeenCalled();
    expect(phaseUpdate).not.toHaveBeenCalled();
    expect(macrocycleUpdate).not.toHaveBeenCalled();
    expect(coachingLogCreate).not.toHaveBeenCalled();
  });

  it("dryRun still reports the row count it would have deleted", async () => {
    weeklyPlanCount.mockResolvedValue(4);
    const result = await handleCoachingAction(
      USER_ID,
      "resetBlock",
      { targetBlockNumber: 2, dryRun: true },
      "preview",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const details = result.details as Record<string, unknown>;
      expect(details.deletedRows).toBe(4);
      expect(details.createdRows).toBe(4);
      expect(details.weeksAdded).toBe(7);
      expect(details.dryRun).toBe(true);
    }
  });
});
