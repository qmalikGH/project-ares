// Sprint v0.14: Focus-adjusted BLOCK_CONFIGS tests.
import { describe, it, expect } from "vitest";

import { adjustBlockConfigsForFocus } from "@/lib/coach-engine/periodization/focus-configs";
import { BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";
import type { BlockNumber } from "@/lib/coach-engine/types";

describe("adjustBlockConfigsForFocus", () => {
  it("balanced → returns input unchanged (reference equality)", () => {
    const result = adjustBlockConfigsForFocus(BLOCK_CONFIGS, "balanced");
    expect(result).toBe(BLOCK_CONFIGS);
  });

  describe("strength_focus", () => {
    const adjusted = adjustBlockConfigsForFocus(BLOCK_CONFIGS, "strength_focus");

    it("B1 strengthMode = linear_progression", () => {
      expect(adjusted[1].strengthMode).toBe("linear_progression");
    });

    it("B3 strengthMode = linear_progression (not maintenance)", () => {
      expect(adjusted[3].strengthMode).toBe("linear_progression");
    });

    it("B4 strengthMode = linear_progression (not maintenance)", () => {
      expect(adjusted[4].strengthMode).toBe("linear_progression");
    });

    it("B5 strengthMode = maintenance (taper)", () => {
      expect(adjusted[5].strengthMode).toBe("maintenance");
    });

    it("B3 rpeCap = 9 (elevated from default 7)", () => {
      expect(adjusted[3].strengthRpeCap).toBe(9);
    });

    it("B1 rpeCap = 8 (unchanged for early blocks)", () => {
      expect(adjusted[1].strengthRpeCap).toBe(8);
    });

    it("run baselines reduced to 80% (long run)", () => {
      const b1Long = BLOCK_CONFIGS[1].longRunBaselineMin ?? 50;
      expect(adjusted[1].longRunBaselineMin).toBe(Math.round(b1Long * 0.80));
    });

    it("run baselines reduced to 80% (quality)", () => {
      const b2Quality = BLOCK_CONFIGS[2].qualityRunBaselineMin ?? 40;
      expect(adjusted[2].qualityRunBaselineMin).toBe(Math.round(b2Quality * 0.80));
    });

    it("easy baselines reduced to 85%", () => {
      const b1Easy = BLOCK_CONFIGS[1].easyRunBaselineMin ?? 35;
      expect(adjusted[1].easyRunBaselineMin).toBe(Math.round(b1Easy * 0.85));
    });
  });

  describe("endurance_focus", () => {
    const adjusted = adjustBlockConfigsForFocus(BLOCK_CONFIGS, "endurance_focus");

    it("all blocks strengthMode = maintenance", () => {
      for (let i = 1; i <= 5; i++) {
        expect(adjusted[i as BlockNumber].strengthMode).toBe("maintenance");
      }
    });

    it("all blocks rpeCap = 7", () => {
      for (let i = 1; i <= 5; i++) {
        expect(adjusted[i as BlockNumber].strengthRpeCap).toBe(7);
      }
    });

    it("long run baselines increased to 120%", () => {
      const b1Long = BLOCK_CONFIGS[1].longRunBaselineMin ?? 50;
      expect(adjusted[1].longRunBaselineMin).toBe(Math.round(b1Long * 1.20));
    });

    it("quality baselines increased to 115%", () => {
      const b2Quality = BLOCK_CONFIGS[2].qualityRunBaselineMin ?? 40;
      expect(adjusted[2].qualityRunBaselineMin).toBe(Math.round(b2Quality * 1.15));
    });

    it("easy baselines unchanged", () => {
      expect(adjusted[1].easyRunBaselineMin).toBe(BLOCK_CONFIGS[1].easyRunBaselineMin);
    });
  });

  describe("recomp", () => {
    const adjusted = adjustBlockConfigsForFocus(BLOCK_CONFIGS, "recomp");

    it("B1 long run reduced to 90%", () => {
      const b1Long = BLOCK_CONFIGS[1].longRunBaselineMin ?? 50;
      expect(adjusted[1].longRunBaselineMin).toBe(Math.round(b1Long * 0.90));
    });

    it("B1 quality reduced to 90%", () => {
      const b1Quality = BLOCK_CONFIGS[1].qualityRunBaselineMin ?? 30;
      expect(adjusted[1].qualityRunBaselineMin).toBe(Math.round(b1Quality * 0.90));
    });

    it("B2 unchanged from base (only B1 is conservative)", () => {
      expect(adjusted[2].longRunBaselineMin).toBe(BLOCK_CONFIGS[2].longRunBaselineMin);
      expect(adjusted[2].qualityRunBaselineMin).toBe(BLOCK_CONFIGS[2].qualityRunBaselineMin);
    });

    it("strengthMode unchanged from base (balanced default)", () => {
      expect(adjusted[1].strengthMode).toBe(BLOCK_CONFIGS[1].strengthMode);
      expect(adjusted[3].strengthMode).toBe(BLOCK_CONFIGS[3].strengthMode);
    });
  });

  it("does not mutate original BLOCK_CONFIGS", () => {
    const origB1Long = BLOCK_CONFIGS[1].longRunBaselineMin;
    adjustBlockConfigsForFocus(BLOCK_CONFIGS, "strength_focus");
    expect(BLOCK_CONFIGS[1].longRunBaselineMin).toBe(origB1Long);
  });

  it("is deterministic", () => {
    const a = adjustBlockConfigsForFocus(BLOCK_CONFIGS, "strength_focus");
    const b = adjustBlockConfigsForFocus(BLOCK_CONFIGS, "strength_focus");
    expect(a).toEqual(b);
  });
});
