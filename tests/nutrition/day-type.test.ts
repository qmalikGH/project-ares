import { describe, expect, it } from "vitest";
import {
  DAY_TYPE_BY_WEEKDAY,
  INITIAL_TARGETS,
  SLOT_PRESENCE,
  getDayType,
} from "@/lib/nutrition/day-type";

// Reference dates (UTC) for each weekday so we don't depend on `new Date()`.
// 2026-05-04 is a Monday in UTC.
const MON = new Date("2026-05-04T00:00:00.000Z");
const TUE = new Date("2026-05-05T00:00:00.000Z");
const WED = new Date("2026-05-06T00:00:00.000Z");
const THU = new Date("2026-05-07T00:00:00.000Z");
const FRI = new Date("2026-05-08T00:00:00.000Z");
const SAT = new Date("2026-05-09T00:00:00.000Z");
const SUN = new Date("2026-05-10T00:00:00.000Z");

describe("getDayType — weekday mapping", () => {
  it("Monday → strength_run", () => expect(getDayType(MON)).toBe("strength_run"));
  it("Tuesday → threshold", () => expect(getDayType(TUE)).toBe("threshold"));
  it("Wednesday → rest", () => expect(getDayType(WED)).toBe("rest"));
  it("Thursday → strength_run", () => expect(getDayType(THU)).toBe("strength_run"));
  it("Friday → strength_run", () => expect(getDayType(FRI)).toBe("strength_run"));
  it("Saturday → long_run", () => expect(getDayType(SAT)).toBe("long_run"));
  it("Sunday → rest", () => expect(getDayType(SUN)).toBe("rest"));

  it("DAY_TYPE_BY_WEEKDAY has all 7 entries", () => {
    for (let d = 0; d < 7; d++) {
      expect(DAY_TYPE_BY_WEEKDAY[d], `weekday ${d}`).toBeDefined();
    }
  });
});

describe("INITIAL_TARGETS — derived from DAY_TYPE_CONFIGS", () => {
  it("has all 4 day types", () => {
    expect(INITIAL_TARGETS.strength_run).toBeDefined();
    expect(INITIAL_TARGETS.threshold).toBeDefined();
    expect(INITIAL_TARGETS.long_run).toBeDefined();
    expect(INITIAL_TARGETS.rest).toBeDefined();
  });

  it("strength_run target = 2500 kcal (tdee=3000)", () => {
    expect(INITIAL_TARGETS.strength_run.tdeeEstimate).toBe(3000);
    expect(INITIAL_TARGETS.strength_run.calorieTarget).toBe(2500);
  });

  it("threshold target = 2939 kcal (tdee=3439)", () => {
    expect(INITIAL_TARGETS.threshold.calorieTarget).toBe(2939);
    expect(INITIAL_TARGETS.threshold.tdeeEstimate).toBe(3439);
  });

  it("long_run target = 3168 kcal (tdee=3668)", () => {
    expect(INITIAL_TARGETS.long_run.calorieTarget).toBe(3168);
    expect(INITIAL_TARGETS.long_run.tdeeEstimate).toBe(3668);
  });

  it("rest target = 2400 kcal (tdee=2900)", () => {
    expect(INITIAL_TARGETS.rest.calorieTarget).toBe(2400);
    expect(INITIAL_TARGETS.rest.tdeeEstimate).toBe(2900);
  });

  it("protein constant at 190g across all day types", () => {
    for (const t of Object.values(INITIAL_TARGETS)) {
      expect(t.proteinG).toBe(190);
    }
  });

  it("fat constant at 70g across all day types", () => {
    for (const t of Object.values(INITIAL_TARGETS)) {
      expect(t.fatG).toBe(70);
    }
  });

  it("macros are reasonable relative to calorieTarget", () => {
    // In v2, macros are explicit targets from the sprint doc (not derived
    // from calorieTarget). They may not sum exactly to calorieTarget because
    // training days prioritize carbs for performance. The delta represents
    // the "uncounted" portion (fiber, alcohol trace, etc.) or intentional
    // over-provision for performance fueling.
    for (const [name, t] of Object.entries(INITIAL_TARGETS)) {
      const reconstructed = t.proteinG * 4 + t.fatG * 9 + t.carbsG * 4;
      // Allow up to 300 kcal difference (high-activity days over-provision carbs)
      expect(Math.abs(reconstructed - t.calorieTarget), `${name} delta`).toBeLessThanOrEqual(300);
    }
  });
});

describe("SLOT_PRESENCE — derived from DAY_TYPE_CONFIGS", () => {
  it("training days have all 7 slots active", () => {
    for (const dayType of ["strength_run", "threshold", "long_run"] as const) {
      const slots = SLOT_PRESENCE[dayType];
      expect(slots.morning, `${dayType}.morning`).toBe(true);
      expect(slots.preTraining, `${dayType}.preTraining`).toBe(true);
      expect(slots.mainMeal, `${dayType}.mainMeal`).toBe(true);
      expect(slots.postMealDessert, `${dayType}.postMealDessert`).toBe(true);
      expect(slots.afternoonSnack, `${dayType}.afternoonSnack`).toBe(true);
      expect(slots.dinner, `${dayType}.dinner`).toBe(true);
      expect(slots.eveningSnack, `${dayType}.eveningSnack`).toBe(true);
    }
  });

  it("rest day skips preTraining (no nitrate priming)", () => {
    expect(SLOT_PRESENCE.rest.preTraining).toBe(false);
  });

  it("rest day NOW has postMealDessert (Skyr enabled in v2)", () => {
    expect(SLOT_PRESENCE.rest.postMealDessert).toBe(true);
  });

  it("rest day still has main meal + dinner", () => {
    expect(SLOT_PRESENCE.rest.mainMeal).toBe(true);
    expect(SLOT_PRESENCE.rest.dinner).toBe(true);
  });
});
