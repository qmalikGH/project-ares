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
  CALIBRATION_WINDOW_DAYS,
  FIXED_FAT_G,
  FIXED_PROTEIN_G,
  MIN_SAMPLES_PER_DAY_TYPE,
  averageTDEEByDayType,
  computeMacros,
  groupTDEEByDayType,
} from "@/lib/nutrition/calibration";

const MON = new Date("2026-05-04T00:00:00.000Z"); // strength_run
const TUE = new Date("2026-05-05T00:00:00.000Z"); // threshold
const WED = new Date("2026-05-06T00:00:00.000Z"); // rest
const THU = new Date("2026-05-07T00:00:00.000Z"); // strength_run
const FRI = new Date("2026-05-08T00:00:00.000Z"); // strength_run
const SAT = new Date("2026-05-09T00:00:00.000Z"); // long_run
const SUN = new Date("2026-05-10T00:00:00.000Z"); // rest

describe("groupTDEEByDayType", () => {
  it("buckets each row into the correct day-type", () => {
    const rows = [
      { date: MON, totalKilocalories: 3000 },
      { date: TUE, totalKilocalories: 2800 },
      { date: WED, totalKilocalories: 2200 },
      { date: SAT, totalKilocalories: 3200 },
    ];
    const buckets = groupTDEEByDayType(rows);
    expect(buckets.strength_run).toEqual([3000]);
    expect(buckets.threshold).toEqual([2800]);
    expect(buckets.long_run).toEqual([3200]);
    expect(buckets.rest).toEqual([2200]);
  });

  it("aggregates Mon + Thu + Fri into strength_run", () => {
    const rows = [
      { date: MON, totalKilocalories: 3050 },
      { date: THU, totalKilocalories: 2980 },
      { date: FRI, totalKilocalories: 3100 },
    ];
    const buckets = groupTDEEByDayType(rows);
    expect(buckets.strength_run).toEqual([3050, 2980, 3100]);
  });

  it("aggregates Wed + Sun into rest", () => {
    const rows = [
      { date: WED, totalKilocalories: 2200 },
      { date: SUN, totalKilocalories: 2150 },
    ];
    const buckets = groupTDEEByDayType(rows);
    expect(buckets.rest).toEqual([2200, 2150]);
  });

  it("ignores rows with null TDEE", () => {
    const rows = [
      { date: MON, totalKilocalories: 3000 },
      { date: THU, totalKilocalories: null },
    ];
    const buckets = groupTDEEByDayType(rows);
    expect(buckets.strength_run).toEqual([3000]);
  });
});

describe("averageTDEEByDayType", () => {
  it("returns averages only for buckets with >= MIN_SAMPLES samples", () => {
    const buckets = {
      strength_run: [3000, 3050, 3100],
      threshold: [2800, 2850],
      long_run: [3200],
      rest: [],
    };
    const avg = averageTDEEByDayType(buckets);
    expect(avg.strength_run).toBe(3050);
    expect(avg.threshold).toBe(2825);
    expect(avg.long_run).toBeUndefined(); // only 1 sample
    expect(avg.rest).toBeUndefined(); // 0 samples
  });

  it("rounds to nearest integer", () => {
    const buckets = {
      strength_run: [3001, 3002, 3003], // avg = 3002
      threshold: [],
      long_run: [],
      rest: [],
    };
    expect(averageTDEEByDayType(buckets).strength_run).toBe(3002);
  });

  it("returns empty object when no buckets meet threshold", () => {
    const buckets = {
      strength_run: [3000],
      threshold: [2800],
      long_run: [3200],
      rest: [2200],
    };
    expect(averageTDEEByDayType(buckets)).toEqual({});
  });
});

describe("computeMacros", () => {
  it("strength_run TDEE 3000, deficit 500 → target 2500, P190 F70 C195", () => {
    const m = computeMacros(3000, 500);
    expect(m.calorieTarget).toBe(2500);
    expect(m.proteinG).toBe(190);
    expect(m.fatG).toBe(70);
    // 2500 - 190*4 - 70*9 = 2500 - 760 - 630 = 1110 → 1110/4 = 277.5 → 278
    expect(m.carbsG).toBe(278);
  });

  it("rest TDEE 2200, deficit 500 → target 1700, lower carbs", () => {
    const m = computeMacros(2200, 500);
    expect(m.calorieTarget).toBe(1700);
    // 1700 - 760 - 630 = 310 → 310/4 = 77.5 → 78
    expect(m.carbsG).toBe(78);
  });

  it("never returns negative carbs (clamps at 0)", () => {
    const m = computeMacros(1000, 500); // calorieTarget = 500, way too low
    expect(m.carbsG).toBe(0);
  });

  it("uses fixed protein and fat constants", () => {
    const m = computeMacros(2800, 500);
    expect(m.proteinG).toBe(FIXED_PROTEIN_G);
    expect(m.fatG).toBe(FIXED_FAT_G);
  });
});

describe("Constants", () => {
  it("CALIBRATION_WINDOW_DAYS = 14", () => expect(CALIBRATION_WINDOW_DAYS).toBe(14));
  it("MIN_SAMPLES_PER_DAY_TYPE = 2", () => expect(MIN_SAMPLES_PER_DAY_TYPE).toBe(2));
});
