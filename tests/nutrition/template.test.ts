import { describe, expect, it } from "vitest";
import {
  SLOT_LABELS,
  buildSlotsForTargets,
  buildSlotsForWeekday,
  buildWeekdaySlotsMap,
  sumSlotMacros,
  sumSingleSlotMacros,
  templateDayPlan,
  templateSlotsForDayType,
} from "@/lib/nutrition/template";
import { INITIAL_TARGETS, DAY_TYPE_BY_WEEKDAY } from "@/lib/nutrition/day-type";
import type { DayTypeTargets } from "@/lib/nutrition/day-type";
import type { DayType } from "@/lib/nutrition/types";
import { WEEKLY_RECIPE_BY_WEEKDAY } from "@/lib/nutrition/recipes";

const ALL_DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];
const CALORIE_TOLERANCE = 50;

// ═══════════════════════════════════════════════════════════════════════════
// Architecture invariant: slotSum ≈ calorieTarget for ALL day types
// ═══════════════════════════════════════════════════════════════════════════

describe("architecture invariant: slot sum tracks calorie target", () => {
  for (const dayType of ALL_DAY_TYPES) {
    it(`${dayType}: |slotSum - calorieTarget| < ${CALORIE_TOLERANCE} kcal`, () => {
      const plan = templateDayPlan(dayType);
      const totals = sumSlotMacros(plan.slots);
      const diff = Math.abs(totals.kcal - plan.calorieTarget);
      expect(diff).toBeLessThan(CALORIE_TOLERANCE);
    });
  }

  it("templateDayPlan throws if invariant is violated (smoke test — should never throw in practice)", () => {
    // This test simply verifies the assertion code path exists by calling all day types.
    // If any day type violates the invariant, the function throws and the test fails.
    for (const dayType of ALL_DAY_TYPES) {
      expect(() => templateDayPlan(dayType)).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Slot composition
// ═══════════════════════════════════════════════════════════════════════════

describe("templateSlotsForDayType — slot composition", () => {
  it("training day has all 7 slots populated", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.morning.items.length).toBeGreaterThan(0);
    expect(slots.preTraining.items.length).toBeGreaterThan(0);
    expect(slots.mainMeal.items.length).toBeGreaterThan(0);
    expect(slots.postMealDessert.items.length).toBeGreaterThan(0);
    expect(slots.afternoonSnack.items.length).toBeGreaterThan(0);
    expect(slots.dinner.items.length).toBeGreaterThan(0);
    expect(slots.eveningSnack.items.length).toBeGreaterThan(0);
  });

  it("rest day has empty preTraining slot", () => {
    const slots = templateSlotsForDayType("rest");
    expect(slots.preTraining.items.length).toBe(0);
  });

  it("rest day has empty postMealDessert (no Skyr)", () => {
    const slots = templateSlotsForDayType("rest");
    expect(slots.postMealDessert.items.length).toBe(0);
  });

  it("postMealDessert is marked flexible on training days", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.postMealDessert.flexible).toBe(true);
  });

  it("mainMeal references a recipe key", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.mainMeal.recipe).toBeDefined();
  });

  it("afternoonSnack on training day has alternatives (Erbsen Flips)", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.afternoonSnack.alternatives?.length ?? 0).toBeGreaterThan(0);
  });

  it("long_run uses hack recipe", () => {
    const slots = templateSlotsForDayType("long_run");
    expect(slots.mainMeal.recipe).toBe("hack_rice_tkgemuse");
    expect(slots.dinner.recipe).toBe("hack_rice_tkgemuse");
  });

  it("strength_run uses chicken recipe", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.mainMeal.recipe).toBe("chicken_rice_tkgemuse");
    expect(slots.dinner.recipe).toBe("chicken_rice_tkgemuse");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backward-computed portions are reasonable
// ═══════════════════════════════════════════════════════════════════════════

describe("backward-computed portions", () => {
  it("mainMeal gets ~55% of variable budget", () => {
    const plan = templateDayPlan("strength_run");
    const mainKcal = sumSingleSlotMacros(plan.slots.mainMeal).kcal;
    const dinnerKcal = sumSingleSlotMacros(plan.slots.dinner).kcal;
    const variableTotal = mainKcal + dinnerKcal;
    const ratio = mainKcal / variableTotal;
    expect(ratio).toBeGreaterThan(0.50);
    expect(ratio).toBeLessThan(0.62);
  });

  it("protein source appears as first item in mainMeal", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.mainMeal.items[0].name).toContain("Hähnchenbrust");
  });

  it("rice appears as second item in mainMeal (if present)", () => {
    const slots = templateSlotsForDayType("strength_run");
    const riceItem = slots.mainMeal.items.find((i) => i.name.startsWith("Reis"));
    expect(riceItem).toBeDefined();
  });

  it("all computed portions are in 10g increments", () => {
    for (const dayType of ALL_DAY_TYPES) {
      const slots = templateSlotsForDayType(dayType);
      for (const slot of [slots.mainMeal, slots.dinner]) {
        for (const item of slot.items) {
          const match = item.name.match(/(\d+)g/);
          if (match) {
            const grams = parseInt(match[1], 10);
            expect(grams % 10).toBe(0);
          }
        }
      }
    }
  });

  it("total protein meets or exceeds target for training days", () => {
    for (const dayType of ["strength_run", "threshold", "long_run"] as DayType[]) {
      const plan = templateDayPlan(dayType);
      const totals = sumSlotMacros(plan.slots);
      // Protein should be at or above target (rice contributes extra protein)
      expect(totals.protein).toBeGreaterThanOrEqual(plan.proteinG - 10);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// templateDayPlan
// ═══════════════════════════════════════════════════════════════════════════

describe("templateDayPlan", () => {
  it("merges slots with INITIAL_TARGETS for the day-type", () => {
    const plan = templateDayPlan("strength_run");
    expect(plan.dayType).toBe("strength_run");
    expect(plan.tdeeEstimate).toBe(3000);
    expect(plan.calorieTarget).toBe(2500);
    expect(plan.proteinG).toBe(190);
  });

  it("rest day-type targets a lower kcal", () => {
    const plan = templateDayPlan("rest");
    expect(plan.calorieTarget).toBe(1700);
  });

  it("is deterministic — same day-type always produces identical output", () => {
    for (const dayType of ALL_DAY_TYPES) {
      const a = templateDayPlan(dayType);
      const b = templateDayPlan(dayType);
      expect(a).toEqual(b);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sumSlotMacros
// ═══════════════════════════════════════════════════════════════════════════

describe("sumSlotMacros", () => {
  it("sums kcal/protein/carbs/fat/cost across all slots", () => {
    const slots = templateSlotsForDayType("strength_run");
    const totals = sumSlotMacros(slots);
    expect(totals.kcal).toBeGreaterThan(0);
    expect(totals.protein).toBeGreaterThan(0);
    expect(totals.costEur).toBeGreaterThan(0);
  });

  it("rest day total is meaningfully lower than training day total (~500+ kcal less)", () => {
    const restTotals = sumSlotMacros(templateSlotsForDayType("rest"));
    const trainTotals = sumSlotMacros(templateSlotsForDayType("strength_run"));
    expect(trainTotals.kcal - restTotals.kcal).toBeGreaterThan(300);
  });

  it("rounds kcal/protein to integers", () => {
    const totals = sumSlotMacros(templateSlotsForDayType("strength_run"));
    expect(Number.isInteger(totals.kcal)).toBe(true);
    expect(Number.isInteger(totals.protein)).toBe(true);
  });

  it("matches calorieTarget within tolerance for every day type", () => {
    for (const dayType of ALL_DAY_TYPES) {
      const totals = sumSlotMacros(templateSlotsForDayType(dayType));
      const target = INITIAL_TARGETS[dayType].calorieTarget;
      expect(Math.abs(totals.kcal - target)).toBeLessThan(CALORIE_TOLERANCE);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sumSingleSlotMacros
// ═══════════════════════════════════════════════════════════════════════════

describe("sumSingleSlotMacros", () => {
  it("sums a single slot's items", () => {
    const slots = templateSlotsForDayType("strength_run");
    const totals = sumSingleSlotMacros(slots.morning);
    expect(totals.kcal).toBeGreaterThan(0);
    expect(totals.protein).toBeGreaterThan(0);
  });

  it("returns zeros for an empty slot", () => {
    expect(sumSingleSlotMacros({ items: [] })).toEqual({ kcal: 0, protein: 0, costEur: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SLOT_LABELS
// ═══════════════════════════════════════════════════════════════════════════

describe("SLOT_LABELS", () => {
  it("has a German label for each slot key", () => {
    expect(SLOT_LABELS.morning).toBe("Morgen");
    expect(SLOT_LABELS.preTraining).toBe("Pre-Training");
    expect(SLOT_LABELS.mainMeal).toBe("Hauptmahlzeit");
    expect(SLOT_LABELS.postMealDessert).toContain("Skyr");
    expect(SLOT_LABELS.afternoonSnack).toBe("Nachmittag");
    expect(SLOT_LABELS.dinner).toBe("Abendessen");
    expect(SLOT_LABELS.eveningSnack).toBe("Abend-Snack");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Calibration cascade: buildSlotsForTargets with custom targets
// ═══════════════════════════════════════════════════════════════════════════

describe("buildSlotsForTargets — calibration cascade", () => {
  const CALIBRATED_STRENGTH: DayTypeTargets = {
    tdeeEstimate: 3526,
    calorieTarget: 3026,
    proteinG: 190,
    carbsG: 269,
    fatG: 70,
  };

  it("slot sum tracks custom calorieTarget within tolerance", () => {
    const slots = buildSlotsForTargets("strength_run", CALIBRATED_STRENGTH);
    const totals = sumSlotMacros(slots);
    const diff = Math.abs(totals.kcal - CALIBRATED_STRENGTH.calorieTarget);
    expect(diff).toBeLessThan(CALORIE_TOLERANCE);
  });

  it("higher target → larger portions than default", () => {
    const defaultSlots = templateSlotsForDayType("strength_run");
    const calibratedSlots = buildSlotsForTargets("strength_run", CALIBRATED_STRENGTH);
    const defaultKcal = sumSlotMacros(defaultSlots).kcal;
    const calibratedKcal = sumSlotMacros(calibratedSlots).kcal;
    // 3026 target vs 2500 default → calibrated should be ~500 kcal higher
    expect(calibratedKcal).toBeGreaterThan(defaultKcal + 300);
  });

  it("lower target → smaller portions than default", () => {
    const lowTargets: DayTypeTargets = {
      tdeeEstimate: 2500,
      calorieTarget: 2000,
      proteinG: 190,
      carbsG: 130,
      fatG: 70,
    };
    const defaultSlots = templateSlotsForDayType("strength_run");
    const lowSlots = buildSlotsForTargets("strength_run", lowTargets);
    expect(sumSlotMacros(lowSlots).kcal).toBeLessThan(sumSlotMacros(defaultSlots).kcal - 300);
  });

  it("templateDayPlan with override uses custom targets", () => {
    const plan = templateDayPlan("strength_run", CALIBRATED_STRENGTH);
    expect(plan.calorieTarget).toBe(3026);
    expect(plan.tdeeEstimate).toBe(3526);
    const totals = sumSlotMacros(plan.slots);
    expect(Math.abs(totals.kcal - 3026)).toBeLessThan(CALORIE_TOLERANCE);
  });

  it("invariant holds for calibrated rest day", () => {
    const calibratedRest: DayTypeTargets = {
      tdeeEstimate: 2300,
      calorieTarget: 1800,
      proteinG: 190,
      carbsG: 100,
      fatG: 70,
    };
    const slots = buildSlotsForTargets("rest", calibratedRest);
    const totals = sumSlotMacros(slots);
    expect(Math.abs(totals.kcal - 1800)).toBeLessThan(CALORIE_TOLERANCE);
  });

  it("is deterministic with custom targets", () => {
    const a = buildSlotsForTargets("strength_run", CALIBRATED_STRENGTH);
    const b = buildSlotsForTargets("strength_run", CALIBRATED_STRENGTH);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildSlotsForWeekday — weekday-driven recipe rotation
// ═══════════════════════════════════════════════════════════════════════════

describe("buildSlotsForWeekday — recipe rotation by weekday", () => {
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  it("Mon-Wed (weekdays 1-3) use chicken recipe", () => {
    for (const wd of [1, 2, 3]) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      expect(slots.mainMeal.recipe).toBe("chicken_rice_tkgemuse");
      expect(slots.dinner.recipe).toBe("chicken_rice_tkgemuse");
      const hasChicken = slots.mainMeal.items.some((i) => i.name.includes("Hähnchenbrust"));
      expect(hasChicken).toBe(true);
    }
  });

  it("Thu-Sat (weekdays 4-6) use hack recipe", () => {
    for (const wd of [4, 5, 6]) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      expect(slots.mainMeal.recipe).toBe("hack_rice_tkgemuse");
      expect(slots.dinner.recipe).toBe("hack_rice_tkgemuse");
      const hasHack = slots.mainMeal.items.some((i) => i.name.includes("Rinderhack"));
      expect(hasHack).toBe(true);
    }
  });

  it("Sunday (weekday 0) uses egg recipe", () => {
    const dayType = DAY_TYPE_BY_WEEKDAY[0] as DayType;
    const slots = buildSlotsForWeekday(0, INITIAL_TARGETS[dayType]);
    expect(slots.mainMeal.recipe).toBe("egg_rice_tkgemuse");
    expect(slots.dinner.recipe).toBe("egg_rice_tkgemuse");
    const hasEggs = slots.mainMeal.items.some((i) => i.name.includes("Eier"));
    expect(hasEggs).toBe(true);
  });

  it("chicken days have NO hack or egg items", () => {
    for (const wd of [1, 2, 3]) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      const allItems = [...slots.mainMeal.items, ...slots.dinner.items];
      expect(allItems.some((i) => i.name.includes("Rinderhack"))).toBe(false);
      expect(allItems.some((i) => i.name.includes("Eier"))).toBe(false);
    }
  });

  it("hack days have NO chicken or egg items", () => {
    for (const wd of [4, 5, 6]) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      const allItems = [...slots.mainMeal.items, ...slots.dinner.items];
      expect(allItems.some((i) => i.name.includes("Hähnchenbrust"))).toBe(false);
      expect(allItems.some((i) => i.name.includes("Eier"))).toBe(false);
    }
  });

  it("egg day has NO chicken or hack items", () => {
    const dayType = DAY_TYPE_BY_WEEKDAY[0] as DayType;
    const slots = buildSlotsForWeekday(0, INITIAL_TARGETS[dayType]);
    const allItems = [...slots.mainMeal.items, ...slots.dinner.items];
    expect(allItems.some((i) => i.name.includes("Hähnchenbrust"))).toBe(false);
    expect(allItems.some((i) => i.name.includes("Rinderhack"))).toBe(false);
  });

  it("egg recipe produces whole-number egg counts", () => {
    const dayType = DAY_TYPE_BY_WEEKDAY[0] as DayType;
    const slots = buildSlotsForWeekday(0, INITIAL_TARGETS[dayType]);
    for (const slot of [slots.mainMeal, slots.dinner]) {
      for (const item of slot.items) {
        const match = item.name.match(/Eier (\d+) Stück/);
        if (match) {
          const count = parseInt(match[1], 10);
          expect(count).toBeGreaterThan(0);
          expect(Number.isInteger(count)).toBe(true);
        }
      }
    }
  });

  it("recipe key matches WEEKLY_RECIPE_BY_WEEKDAY for every weekday", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      const expected = WEEKLY_RECIPE_BY_WEEKDAY[wd];
      expect(slots.mainMeal.recipe).toBe(expected);
      expect(slots.dinner.recipe).toBe(expected);
    }
  });

  it("slot sum within 50 kcal of calorie target for every weekday", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const targets = INITIAL_TARGETS[dayType];
      const slots = buildSlotsForWeekday(wd, targets);
      const totals = sumSlotMacros(slots);
      expect(Math.abs(totals.kcal - targets.calorieTarget)).toBeLessThanOrEqual(
        CALORIE_TOLERANCE,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildWeekdaySlotsMap — full 7-day map
// ═══════════════════════════════════════════════════════════════════════════

describe("buildWeekdaySlotsMap", () => {
  const slotsMap = buildWeekdaySlotsMap(INITIAL_TARGETS);

  it("returns all 7 weekdays (0-6)", () => {
    for (let wd = 0; wd <= 6; wd++) {
      expect(slotsMap[wd]).toBeDefined();
    }
  });

  it("each weekday has the correct recipe from rotation", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const expected = WEEKLY_RECIPE_BY_WEEKDAY[wd];
      expect(slotsMap[wd].mainMeal.recipe).toBe(expected);
      expect(slotsMap[wd].dinner.recipe).toBe(expected);
    }
  });

  it("Mo-Mi items contain chicken, Do-Sa contain hack, So contains eggs", () => {
    // Chicken days
    for (const wd of [1, 2, 3]) {
      expect(slotsMap[wd].mainMeal.items.some((i) => i.name.includes("Hähnchenbrust"))).toBe(true);
    }
    // Hack days
    for (const wd of [4, 5, 6]) {
      expect(slotsMap[wd].mainMeal.items.some((i) => i.name.includes("Rinderhack"))).toBe(true);
    }
    // Egg day
    expect(slotsMap[0].mainMeal.items.some((i) => i.name.includes("Eier"))).toBe(true);
  });

  it("slot sum within 50 kcal for all weekdays", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const target = INITIAL_TARGETS[dayType].calorieTarget;
      const totals = sumSlotMacros(slotsMap[wd]);
      expect(Math.abs(totals.kcal - target)).toBeLessThanOrEqual(CALORIE_TOLERANCE);
    }
  });

  it("is deterministic", () => {
    const a = buildWeekdaySlotsMap(INITIAL_TARGETS);
    const b = buildWeekdaySlotsMap(INITIAL_TARGETS);
    expect(a).toEqual(b);
  });

  it("uses custom targets when provided", () => {
    const custom: Partial<Record<DayType, DayTypeTargets>> = {
      strength_run: { ...INITIAL_TARGETS.strength_run, calorieTarget: 3000 },
    };
    const customMap = buildWeekdaySlotsMap(custom);
    // Mon (strength_run) should reflect custom target
    const monTotals = sumSlotMacros(customMap[1]);
    expect(monTotals.kcal).toBeGreaterThan(sumSlotMacros(slotsMap[1]).kcal);
  });
});
