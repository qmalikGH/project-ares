// Sprint 3.4 (#28) — "is the watch delivering anything?"
import { describe, expect, it } from "vitest";

import { hasWatchData, watchDataGaps } from "@/lib/garmin/data-gaps";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("hasWatchData", () => {
  it("needs a resting HR or a sleep score", () => {
    expect(hasWatchData({ rhr: 1 })).toBe(true);
    expect(hasWatchData({ sleepScore: 1 })).toBe(true);
    expect(hasWatchData({ rhr: null, sleepScore: null, hrvRmssd: null })).toBe(false);
    expect(hasWatchData(null)).toBe(false);
  });
});

describe("watchDataGaps", () => {
  it("lists the gaps ascending and counts the run ending yesterday", () => {
    const rows = [{ date: d("2026-11-22"), garmin: { rhr: 1 } }];
    const out = watchDataGaps(rows, d("2026-11-26"), 7);
    expect(out.missing).toEqual(["2026-11-20", "2026-11-21", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]);
    expect(out.streak).toBe(4);
  });

  it("has no streak when yesterday has data", () => {
    const out = watchDataGaps([{ date: d("2026-11-26"), garmin: { sleepScore: 1 } }], d("2026-11-26"), 3);
    expect(out.streak).toBe(0);
  });
});
