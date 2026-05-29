import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/queries/sensors", () => ({
  dayKey: (d: Date) => {
    const r = new Date(d);
    r.setUTCHours(0, 0, 0, 0);
    return r;
  },
}));

import {
  ADJUSTMENT_THRESHOLD_KCAL,
  DEFICIT_KCAL,
  buildAdjustmentMessage,
  computeAdjustments,
} from "@/lib/nutrition/daily-adjustment";

describe("computeAdjustments — threshold", () => {
  it("returns no adjustments when delta is below threshold", () => {
    expect(computeAdjustments(0)).toEqual([]);
    expect(computeAdjustments(50)).toEqual([]);
    expect(computeAdjustments(99)).toEqual([]);
    expect(computeAdjustments(-50)).toEqual([]);
  });

  it("ignores negative deltas (under-planned) for now", () => {
    expect(computeAdjustments(-200)).toEqual([]);
    expect(computeAdjustments(-500)).toEqual([]);
  });
});

describe("computeAdjustments — single Skyr lever", () => {
  it("delta = 130 → only Skyr removed", () => {
    const adj = computeAdjustments(130);
    expect(adj).toHaveLength(1);
    expect(adj[0].slot).toBe("postMealDessert");
    expect(adj[0].action).toBe("remove");
    expect(adj[0].kcalEffect).toBe(-130);
  });

  it("delta = 200 → only Skyr (next lever needs delta > 200)", () => {
    const adj = computeAdjustments(200);
    expect(adj).toHaveLength(1);
    expect(adj[0].slot).toBe("postMealDessert");
  });
});

describe("computeAdjustments — Skyr + snack/dinner", () => {
  it("delta = 300 → Skyr + dinner (snack threshold > 200 not met after Skyr)", () => {
    // 300 - 130 = 170, snack needs > 200 → skip; dinner > 100 → trigger
    const adj = computeAdjustments(300);
    expect(adj).toHaveLength(2);
    expect(adj.map((a) => a.slot)).toEqual(["postMealDessert", "dinner"]);
  });

  it("delta = 400 → Skyr + snack (dinner skipped because remaining negative)", () => {
    // 400 - 130 = 270, snack > 200 → trigger; after = -105, dinner skipped
    const adj = computeAdjustments(400);
    expect(adj).toHaveLength(2);
    expect(adj.map((a) => a.slot)).toEqual(["postMealDessert", "afternoonSnack"]);
    expect(adj[1].kcalEffect).toBe(-375);
  });

  it("delta = 500 → Skyr + snack (still no dinner cut)", () => {
    const adj = computeAdjustments(500);
    expect(adj).toHaveLength(2);
    expect(adj.map((a) => a.slot)).toEqual(["postMealDessert", "afternoonSnack"]);
  });
});

describe("computeAdjustments — full stack", () => {
  it("delta = 700 → Skyr + snack + dinner", () => {
    const adj = computeAdjustments(700);
    expect(adj).toHaveLength(3);
    expect(adj.map((a) => a.slot)).toEqual([
      "postMealDessert",
      "afternoonSnack",
      "dinner",
    ]);
  });

  it("dinner cut effect = -150 kcal", () => {
    const adj = computeAdjustments(700);
    expect(adj[2].kcalEffect).toBe(-150);
    expect(adj[2].action).toBe("reduce");
  });

  it("each adjustment carries a German reason string", () => {
    const adj = computeAdjustments(700);
    expect(adj[0].reason).toContain("Skyr");
    expect(adj[1].reason).toContain("Hummus");
    expect(adj[2].reason).toContain("Dinner");
  });
});

describe("buildAdjustmentMessage", () => {
  it("includes TDEE, planned intake, target intake, and delta", () => {
    const msg = buildAdjustmentMessage(2150, 2500, computeAdjustments(150));
    expect(msg).toContain("2150");
    expect(msg).toContain("2500");
    expect(msg).toContain("1550"); // target = 2150 - 600 (v1.7)
  });

  it("when delta is positive, shows + sign", () => {
    const msg = buildAdjustmentMessage(2150, 2500, computeAdjustments(150));
    expect(msg).toContain("Delta +");
  });

  it("returns 'kein Adjustment nötig' when adjustments is empty", () => {
    const msg = buildAdjustmentMessage(2950, 2500, []);
    expect(msg).toContain("kein Adjustment nötig");
  });

  it("includes adjustment reasons when present", () => {
    const msg = buildAdjustmentMessage(2150, 2500, computeAdjustments(500));
    expect(msg).toContain("Skyr");
    expect(msg).toContain("Hummus");
  });
});

describe("Constants", () => {
  it("DEFICIT_KCAL = 600", () => expect(DEFICIT_KCAL).toBe(600));
  it("ADJUSTMENT_THRESHOLD_KCAL = 100", () => expect(ADJUSTMENT_THRESHOLD_KCAL).toBe(100));
});
