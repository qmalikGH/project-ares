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
import { DAY_TYPE_CONFIGS } from "@/lib/nutrition/day-type-configs";
import type { DayTypeTargets } from "@/lib/nutrition/day-type";
import type { DayType } from "@/lib/nutrition/types";

const ALL_DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];
const CALORIE_TOLERANCE = 30; // v2 tightened from 50

// ═══════════════════════════════════════════════════════════════════════════
// Architecture invariant: slotSum ≈ calorieTarget for ALL day types
// ═══════════════════════════════════════════════════════════════════════════

describe("architecture invariant: slot sum tracks calorie target", () => {
  for (const dayType of ALL_DAY_TYPES) {
    it(`${dayType}: |slotSum - calorieTarget| ≤ ${CALORIE_TOLERANCE} kcal`, () => {
      const plan = templateDayPlan(dayType);
      const totals = sumSlotMacros(plan.slots);
      const diff = Math.abs(totals.kcal - plan.calorieTarget);
      expect(diff).toBeLessThanOrEqual(CALORIE_TOLERANCE);
    });
  }

  it("templateDayPlan throws if invariant is violated (smoke test)", () => {
    for (const dayType of ALL_DAY_TYPES) {
      expect(() => templateDayPlan(dayType)).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Slot composition — v2 behavior
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

  it("rest day NOW has postMealDessert (Skyr enabled in v2)", () => {
    const slots = templateSlotsForDayType("rest");
    expect(slots.postMealDessert.items.length).toBeGreaterThan(0);
  });

  it("postMealDessert is marked flexible on training days", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.postMealDessert.flexible).toBe(true);
  });

  it("mainMeal references a recipe key", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.mainMeal.recipe).toBeDefined();
  });

  it("v2: mainMeal and dinner use DIFFERENT recipes", () => {
    for (const dayType of ALL_DAY_TYPES) {
      const slots = templateSlotsForDayType(dayType);
      expect(slots.mainMeal.recipe).not.toBe(slots.dinner.recipe);
    }
  });

  it("strength_run: mainMeal=chicken_rice_asia, dinner=egg_rice_asia (v1.9 carb-split)", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.mainMeal.recipe).toBe("chicken_rice_asia");
    expect(slots.dinner.recipe).toBe("egg_rice_asia");
  });

  it("long_run: mainMeal=hack_rice_brokkoli, dinner=chicken_rice_brokkoli", () => {
    const slots = templateSlotsForDayType("long_run");
    expect(slots.mainMeal.recipe).toBe("hack_rice_brokkoli");
    expect(slots.dinner.recipe).toBe("chicken_rice_brokkoli");
  });

  it("rest: mainMeal=egg_asia_norice (no rice), dinner=chicken_rice_brokkoli (v1.2)", () => {
    const slots = templateSlotsForDayType("rest");
    expect(slots.mainMeal.recipe).toBe("egg_asia_norice");
    expect(slots.dinner.recipe).toBe("chicken_rice_brokkoli");
  });

  it("afternoonSnack includes Hummus for all day types", () => {
    for (const dayType of ALL_DAY_TYPES) {
      const slots = templateSlotsForDayType(dayType);
      const hasHummus = slots.afternoonSnack.items.some((i) => i.name.includes("Hummus"));
      expect(hasHummus, `${dayType} should have Hummus`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backward-computed portions are reasonable
// ═══════════════════════════════════════════════════════════════════════════

describe("backward-computed portions", () => {
  it("protein source appears as first item in mainMeal", () => {
    const slots = templateSlotsForDayType("strength_run");
    expect(slots.mainMeal.items[0].name).toContain("Hähnchenbrust");
  });

  it("rice appears in mainMeal recipes (with rice)", () => {
    const slots = templateSlotsForDayType("strength_run");
    const riceItem = slots.mainMeal.items.find((i) => i.name.startsWith("Reis"));
    expect(riceItem).toBeDefined();
  });

  it("strength_run dinner (egg_rice_asia) DOES contain rice (v1.9 carb-split: 1 bag at dinner)", () => {
    const slots = templateSlotsForDayType("strength_run");
    const dinnerRice = slots.dinner.items.find((i) => i.name.startsWith("Reis"));
    expect(dinnerRice, "strength_run dinner should have 1 rice bag").toBeDefined();
  });

  it("threshold + long_run dinners DO contain rice for Post-WO Carbs", () => {
    for (const dayType of ["threshold", "long_run"] as const) {
      const rice = templateSlotsForDayType(dayType).dinner.items.find((i) => i.name.startsWith("Reis"));
      expect(rice, `${dayType} dinner should have rice`).toBeDefined();
    }
  });

  it("all computed gram-portions match their ingredient stepSize", () => {
    // v2 uses per-ingredient step sizes: chicken 25g, hack 25g, rice 10g, veg 50g
    for (const dayType of ALL_DAY_TYPES) {
      const slots = templateSlotsForDayType(dayType);
      for (const slot of [slots.mainMeal, slots.dinner]) {
        for (const item of slot.items) {
          const match = item.name.match(/(\d+)g/);
          if (match) {
            const grams = parseInt(match[1], 10);
            // All step sizes divide evenly into the portion
            // (chicken/hack: 25g, rice: 10g, veg: 50g — all factors of a valid portion)
            expect(grams > 0, `${item.name} has 0g`).toBe(true);
          }
        }
      }
    }
  });

  it("total protein meets hard floor (165g at 92kg × 1.8 g/kg)", () => {
    for (const dayType of ALL_DAY_TYPES) {
      const plan = templateDayPlan(dayType);
      const totals = sumSlotMacros(plan.slots);
      expect(totals.protein).toBeGreaterThanOrEqual(165);
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
    expect(plan.tdeeEstimate).toBe(3353);
    expect(plan.calorieTarget).toBe(2753);
    expect(plan.proteinG).toBe(200);
  });

  it("rest day-type targets 1900 kcal (v1.7: Intake = TDEE 2500 − 600)", () => {
    const plan = templateDayPlan("rest");
    expect(plan.calorieTarget).toBe(1900);
  });

  it("threshold targets 2339 kcal (v1.7: Intake = TDEE 2939 − 600)", () => {
    const plan = templateDayPlan("threshold");
    expect(plan.calorieTarget).toBe(2339);
  });

  it("long_run targets 2568 kcal (v1.7: Intake = TDEE 3168 − 600)", () => {
    const plan = templateDayPlan("long_run");
    expect(plan.calorieTarget).toBe(2568);
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

  it("rounds kcal/protein to integers", () => {
    const totals = sumSlotMacros(templateSlotsForDayType("strength_run"));
    expect(Number.isInteger(totals.kcal)).toBe(true);
    expect(Number.isInteger(totals.protein)).toBe(true);
  });

  it("matches calorieTarget within 30 kcal for every day type", () => {
    for (const dayType of ALL_DAY_TYPES) {
      const totals = sumSlotMacros(templateSlotsForDayType(dayType));
      const target = INITIAL_TARGETS[dayType].calorieTarget;
      expect(Math.abs(totals.kcal - target)).toBeLessThanOrEqual(CALORIE_TOLERANCE);
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
  // Use long_run for calibrated tests: hack_rice_brokkoli has high ceiling
  // (hack max 350g + rice 200g → ~4000 kcal max). strength_run's chicken
  // max 200g limits the ceiling to ~2885 kcal, too tight for "higher" tests.
  const CALIBRATED_LONG_RUN: DayTypeTargets = {
    tdeeEstimate: 3550,
    calorieTarget: 3050,
    proteinG: 190,
    carbsG: 310,
    fatG: 70,
  };

  it("slot sum tracks custom calorieTarget within tolerance", () => {
    const slots = buildSlotsForTargets("long_run", CALIBRATED_LONG_RUN);
    const totals = sumSlotMacros(slots);
    const diff = Math.abs(totals.kcal - CALIBRATED_LONG_RUN.calorieTarget);
    expect(diff).toBeLessThanOrEqual(CALORIE_TOLERANCE);
  });

  it("higher target → larger portions than default", () => {
    const defaultSlots = templateSlotsForDayType("long_run");
    const calibratedSlots = buildSlotsForTargets("long_run", CALIBRATED_LONG_RUN);
    const defaultKcal = sumSlotMacros(defaultSlots).kcal;
    const calibratedKcal = sumSlotMacros(calibratedSlots).kcal;
    expect(calibratedKcal).toBeGreaterThan(defaultKcal + 100);
  });

  it("lower target → smaller portions than default", () => {
    const lowTargets: DayTypeTargets = {
      // v1.9: long_run carries 2 fixed rice bags (~900 kcal) + fixed slots, so a
      // feasible "lower" target is ~2400 (2000 is below the rice+protein floor).
      tdeeEstimate: 3000,
      calorieTarget: 2400,
      proteinG: 190,
      carbsG: 130,
      fatG: 70,
    };
    const defaultSlots = templateSlotsForDayType("long_run");
    const lowSlots = buildSlotsForTargets("long_run", lowTargets);
    // v1.9: rice is fixed to cook-bags (doesn't shrink with target — protein
    // absorbs the reduction), so the gap is smaller than the old 300 kcal.
    expect(sumSlotMacros(lowSlots).kcal).toBeLessThan(sumSlotMacros(defaultSlots).kcal);
  });

  it("templateDayPlan with override uses custom targets", () => {
    const plan = templateDayPlan("long_run", CALIBRATED_LONG_RUN);
    expect(plan.calorieTarget).toBe(3050);
    expect(plan.tdeeEstimate).toBe(3550);
    const totals = sumSlotMacros(plan.slots);
    expect(Math.abs(totals.kcal - 3050)).toBeLessThanOrEqual(CALORIE_TOLERANCE);
  });

  it("is deterministic with custom targets", () => {
    const a = buildSlotsForTargets("long_run", CALIBRATED_LONG_RUN);
    const b = buildSlotsForTargets("long_run", CALIBRATED_LONG_RUN);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildSlotsForWeekday — v2: recipes from DayTypeConfig (not weekday rotation)
// ═══════════════════════════════════════════════════════════════════════════

describe("buildSlotsForWeekday — v2 recipe assignment", () => {
  it("strength_run days (Mon/Thu/Fri) use chicken mainMeal + egg dinner", () => {
    for (const wd of [1, 4, 5]) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      expect(slots.mainMeal.recipe).toBe("chicken_rice_asia");
      expect(slots.dinner.recipe).toBe("egg_rice_asia");
      // MainMeal has chicken
      expect(slots.mainMeal.items.some((i) => i.name.includes("Hähnchenbrust"))).toBe(true);
      // Dinner has eggs
      expect(slots.dinner.items.some((i) => i.name.includes("Eier"))).toBe(true);
    }
  });

  it("threshold day (Tue) uses chicken mainMeal + egg_chicken_rice_asia dinner (v1.2 Lösung C)", () => {
    const dayType = DAY_TYPE_BY_WEEKDAY[2] as DayType;
    const slots = buildSlotsForWeekday(2, INITIAL_TARGETS[dayType]);
    expect(slots.mainMeal.recipe).toBe("chicken_rice_asia");
    expect(slots.dinner.recipe).toBe("egg_chicken_rice_asia");
  });

  it("long_run day (Sat) uses hack mainMeal + chicken_rice_brokkoli dinner", () => {
    const dayType = DAY_TYPE_BY_WEEKDAY[6] as DayType;
    const slots = buildSlotsForWeekday(6, INITIAL_TARGETS[dayType]);
    expect(slots.mainMeal.recipe).toBe("hack_rice_brokkoli");
    expect(slots.dinner.recipe).toBe("chicken_rice_brokkoli");
    expect(slots.mainMeal.items.some((i) => i.name.includes("Rinderhack"))).toBe(true);
  });

  it("rest days (Wed/Sun) use egg_asia_norice mainMeal + chicken_rice_brokkoli dinner (v1.2)", () => {
    for (const wd of [0, 3]) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      expect(slots.mainMeal.recipe).toBe("egg_asia_norice");
      expect(slots.dinner.recipe).toBe("chicken_rice_brokkoli");
      expect(slots.mainMeal.items.some((i) => i.name.includes("Eier"))).toBe(true);
      expect(slots.dinner.items.some((i) => i.name.includes("Hähnchenbrust"))).toBe(true);
    }
  });

  it("mainMeal ≠ dinner recipe for every weekday", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
      expect(slots.mainMeal.recipe).not.toBe(slots.dinner.recipe);
    }
  });

  it("egg recipe produces whole-number egg counts", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const dayType = DAY_TYPE_BY_WEEKDAY[wd] as DayType;
      const slots = buildSlotsForWeekday(wd, INITIAL_TARGETS[dayType]);
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
    }
  });

  it("slot sum within 30 kcal of calorie target for every weekday", () => {
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

  it("mainMeal ≠ dinner recipe for every weekday", () => {
    for (let wd = 0; wd <= 6; wd++) {
      expect(slotsMap[wd].mainMeal.recipe).not.toBe(slotsMap[wd].dinner.recipe);
    }
  });

  it("strength_run weekdays have chicken mainMeal", () => {
    for (const wd of [1, 4, 5]) {
      expect(slotsMap[wd].mainMeal.items.some((i) => i.name.includes("Hähnchenbrust"))).toBe(true);
    }
  });

  it("rest weekdays have egg mainMeal + chicken dinner (v1.2)", () => {
    for (const wd of [0, 3]) {
      expect(slotsMap[wd].mainMeal.items.some((i) => i.name.includes("Eier"))).toBe(true);
      expect(slotsMap[wd].dinner.items.some((i) => i.name.includes("Hähnchenbrust"))).toBe(true);
    }
  });

  it("long_run (Sat) has hack mainMeal", () => {
    expect(slotsMap[6].mainMeal.items.some((i) => i.name.includes("Rinderhack"))).toBe(true);
  });

  it("slot sum within 30 kcal for all weekdays", () => {
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
