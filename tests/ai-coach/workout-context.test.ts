import { describe, it, expect } from "vitest";
import {
  formatWorkoutContext,
  type WorkoutContextInput,
} from "@/lib/ai-coach/prompts/workout-context";
import type { FinalSession, SessionPlan } from "@/lib/coach-engine/types";

const monday = new Date("2026-04-27T00:00:00Z");

const easyRunPlan: SessionPlan = {
  date: monday,
  type: "easy_run",
  durationMin: 35,
  paceTarget: { from: "5:45", to: "6:15" },
  intensityZone: 1,
  rpeTarget: 4,
};

const strengthAPlan: SessionPlan = {
  date: monday,
  type: "strength_a",
  durationMin: 50,
  exercises: [
    { name: "Wall Sit", sets: 5, reps: "45sec", tempo: "iso", restSec: 30 },
    {
      name: "Hex Bar Deadlift",
      sets: 4,
      reps: 5,
      loadPct: 82,
      rpeCap: 8,
      tempo: "3-3-1",
      restSec: 180,
    },
    { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
  ],
  rpeTarget: 7,
};

const baseBlockPosition = {
  blockNumber: 1,
  phaseName: "ACCUMULATION_AEROBIC_BASE",
  weekInBlock: 2,
  weeksTotal: 4,
  daysToNextTimeTrial: 105,
};

describe("formatWorkoutContext", () => {
  it("renders a Monday two-a-day with Easy Run + Strength A", () => {
    const ctx: WorkoutContextInput = {
      today: {
        plannedSessions: [easyRunPlan, strengthAPlan],
        finalSessions: null,
      },
      recentCompleted: [],
      upcoming: [],
      blockPosition: baseBlockPosition,
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("Heutiges Training");
    expect(formatted).toContain("easy_run");
    expect(formatted).toContain("strength_a");
    expect(formatted).toContain("Wall Sit");
    expect(formatted).toContain("Hex Bar Deadlift");
    expect(formatted).toContain("Tempo 3-3-1");
    expect(formatted).toContain("Pause 3min"); // 180s → 3min
    expect(formatted).toContain("@ 82%");
    expect(formatted).toContain("RPE-Cap 8");
    expect(formatted).toContain("Pace: 5:45–6:15/km");
  });

  it("indicates when morning-input is missing", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [easyRunPlan], finalSessions: null },
      recentCompleted: [],
      upcoming: [],
      blockPosition: baseBlockPosition,
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("Morning Check-in noch nicht abgeschlossen");
  });

  it("renders modulated final sessions with modifications list", () => {
    const final: FinalSession = {
      ...strengthAPlan,
      wasModified: true,
      modifications: ["Knee 6 — Last-Cap 70%, Plyo entfernt"],
      confidence: 75,
      explanation: "Knee 6 — Last-Cap 70%, Plyo entfernt",
    };
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [strengthAPlan], finalSessions: [final] },
      recentCompleted: [],
      upcoming: [],
      blockPosition: baseBlockPosition,
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("Modulationen:");
    expect(formatted).toContain("Last-Cap 70%");
    expect(formatted).not.toContain("Morning Check-in noch nicht abgeschlossen");
  });

  it("shows days to next time trial for blocks 1-4", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [], finalSessions: [] },
      recentCompleted: [],
      upcoming: [],
      blockPosition: { ...baseBlockPosition, daysToNextTimeTrial: 42 },
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("42 Tage bis zum nächsten 5k Time Trial");
  });

  it("omits TT countdown when daysToNextTimeTrial is null", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [], finalSessions: [] },
      recentCompleted: [],
      upcoming: [],
      blockPosition: { ...baseBlockPosition, daysToNextTimeTrial: null },
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).not.toContain("Time Trial");
  });

  it("renders today as TT day when countdown is 0", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [], finalSessions: [] },
      recentCompleted: [],
      upcoming: [],
      blockPosition: { ...baseBlockPosition, daysToNextTimeTrial: 0 },
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("Heute ist Time-Trial-Tag");
  });

  it("formats recent completed with RPE + modifications + notes", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [], finalSessions: [] },
      recentCompleted: [
        {
          date: new Date("2026-04-26T00:00:00Z"),
          type: "easy_run",
          rpe: 4,
          durationActualMin: 33,
          notes: "Etwas Wind, Pace passte",
          wasModified: false,
          modifications: [],
        },
        {
          date: new Date("2026-04-25T00:00:00Z"),
          type: "strength_a",
          rpe: 7,
          durationActualMin: 48,
          notes: null,
          wasModified: true,
          modifications: ["Readiness Yellow — Pace auf Marathon"],
        },
      ],
      upcoming: [],
      blockPosition: baseBlockPosition,
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("2026-04-26: easy_run · RPE 4 · 33min");
    expect(formatted).toContain("Etwas Wind");
    expect(formatted).toContain("modulated:");
    expect(formatted).toContain("Readiness Yellow");
  });

  it("handles empty recentCompleted gracefully", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [], finalSessions: [] },
      recentCompleted: [],
      upcoming: [],
      blockPosition: baseBlockPosition,
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("Noch keine abgeschlossenen Sessions");
  });

  it("lists upcoming 7 days with type + duration", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [], finalSessions: [] },
      recentCompleted: [],
      upcoming: [
        { date: new Date("2026-04-28T00:00:00Z"), type: "threshold_run", durationMin: 50, intensityZone: 2 },
        { date: new Date("2026-04-29T00:00:00Z"), type: "easy_run", durationMin: 30, intensityZone: 1 },
      ],
      blockPosition: baseBlockPosition,
    };
    const formatted = formatWorkoutContext(ctx);
    expect(formatted).toContain("2026-04-28: threshold_run · 50min · Z2");
    expect(formatted).toContain("2026-04-29: easy_run · 30min · Z1");
  });

  it("is deterministic — same input → same output", () => {
    const ctx: WorkoutContextInput = {
      today: { plannedSessions: [easyRunPlan], finalSessions: null },
      recentCompleted: [],
      upcoming: [],
      blockPosition: baseBlockPosition,
    };
    const a = formatWorkoutContext(ctx);
    const b = formatWorkoutContext(ctx);
    expect(a).toBe(b);
  });
});
