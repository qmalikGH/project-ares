// Sprint 2.6 (A6) — getEffectiveVdot resolution order.
//
// This function had no test at all, and it decides the number every prescribed
// pace derives from. Two behaviours are pinned here deliberately:
//   1. it must never fall back to a block's vdotTarget (an aspiration)
//   2. the block-review branch is inert TODAY, and must stay inert until A1
//      stops writing `achievedVdot = targetVdot`
import { describe, expect, it, vi, beforeEach } from "vitest";

const findUniqueUserSettings = vi.fn();
const findFirstMacrocycle = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    userSettings: { findUnique: (...a: unknown[]) => findUniqueUserSettings(...a) },
    macrocycle: { findFirst: (...a: unknown[]) => findFirstMacrocycle(...a) },
  },
}));

import { getEffectiveVdot, VDOT_UNMEASURED_FALLBACK } from "@/lib/db/queries/settings";

/** A phase carrying an aspirational target and, optionally, a block review. */
function phase(blockNumber: number, vdotTarget: number, blockReview: unknown = null) {
  return { blockNumber, config: { vdotTarget }, blockReview };
}

beforeEach(() => {
  findUniqueUserSettings.mockReset();
  findFirstMacrocycle.mockReset();
});

describe("priority 1 — the stored override wins", () => {
  it("returns vdotOverride and does not even look at the macrocycle", async () => {
    findUniqueUserSettings.mockResolvedValue({ vdotOverride: 37 });
    expect(await getEffectiveVdot("u1")).toBe(37);
    expect(findFirstMacrocycle).not.toHaveBeenCalled();
  });

  it("a legitimately low override is returned as-is, not floored", async () => {
    findUniqueUserSettings.mockResolvedValue({ vdotOverride: 35 });
    expect(await getEffectiveVdot("u1")).toBe(35);
  });
});

describe("the aspiration must never become a measurement", () => {
  it("does NOT fall back to Block 1's vdotTarget", async () => {
    // Before A6 this returned 42 — the block's GOAL — which would have made
    // every easy pace ~45 s/km faster on the strength of a wish.
    findUniqueUserSettings.mockResolvedValue({ vdotOverride: null });
    findFirstMacrocycle.mockResolvedValue({ phases: [phase(1, 42), phase(2, 43)] });

    const vdot = await getEffectiveVdot("u1");
    expect(vdot).toBe(VDOT_UNMEASURED_FALLBACK);
    expect(vdot).not.toBe(42);
  });

  it("falls back conservatively when there is no macrocycle at all", async () => {
    findUniqueUserSettings.mockResolvedValue({ vdotOverride: null });
    findFirstMacrocycle.mockResolvedValue(null);
    expect(await getEffectiveVdot("u1")).toBe(VDOT_UNMEASURED_FALLBACK);
  });

  it("the unmeasured fallback sits at the conservative end of the pace table", async () => {
    // Too slow costs some stimulus; too fast costs an injury. Also an exact
    // VDOT_TABLE key, so vdotToPaces cannot snap it somewhere else.
    expect(VDOT_UNMEASURED_FALLBACK).toBeLessThanOrEqual(38);
  });
});

describe("priority 2 — block review, deliberately inert", () => {
  it("IGNORES the flat shape the block-review route actually writes", async () => {
    // app/api/coach/block-review/route.ts emits { targetVdot, achievedVdot, ... }
    // while this reads { achieved: { vdot } }. The mismatch is load-bearing:
    // that route sets achievedVdot = targetVdot as a v0.1 placeholder, so making
    // this branch match would feed the block TARGET back in as a measurement.
    // When A1 fixes the placeholder, fix the shape and flip this test.
    findUniqueUserSettings.mockResolvedValue({ vdotOverride: null });
    findFirstMacrocycle.mockResolvedValue({
      phases: [
        phase(1, 42, { performanceMarkerResult: { targetVdot: 42, achievedVdot: 42, met: true } }),
      ],
    });
    expect(await getEffectiveVdot("u1")).toBe(VDOT_UNMEASURED_FALLBACK);
  });

  it("would read a nested measured value, and prefers the latest block", async () => {
    // Documents the intended contract for when A1 lands.
    findUniqueUserSettings.mockResolvedValue({ vdotOverride: null });
    findFirstMacrocycle.mockResolvedValue({
      phases: [
        phase(1, 42, { performanceMarkerResult: { achieved: { vdot: 38 } } }),
        phase(2, 43, { performanceMarkerResult: { achieved: { vdot: 41 } } }),
      ],
    });
    expect(await getEffectiveVdot("u1")).toBe(41);
  });

  it("skips phases without a review", async () => {
    findUniqueUserSettings.mockResolvedValue({ vdotOverride: null });
    findFirstMacrocycle.mockResolvedValue({
      phases: [phase(1, 42, { performanceMarkerResult: { achieved: { vdot: 39 } } }), phase(2, 43)],
    });
    expect(await getEffectiveVdot("u1")).toBe(39);
  });
});
