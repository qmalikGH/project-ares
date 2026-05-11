import { describe, expect, it } from "vitest";
import {
  SLOT_LABELS,
  sumSlotMacros,
  sumSingleSlotMacros,
  templateDayPlan,
  templateSlotsForDayType,
} from "@/lib/nutrition/template";

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
});

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
});

describe("sumSlotMacros", () => {
  it("sums kcal/protein/carbs/fat/cost across all slots", () => {
    const slots = templateSlotsForDayType("strength_run");
    const totals = sumSlotMacros(slots);
    expect(totals.kcal).toBeGreaterThan(0);
    expect(totals.protein).toBeGreaterThan(0);
    expect(totals.costEur).toBeGreaterThan(0);
  });

  it("rest day total is meaningfully lower than training day total (~500 kcal less)", () => {
    const restTotals = sumSlotMacros(templateSlotsForDayType("rest"));
    const trainTotals = sumSlotMacros(templateSlotsForDayType("strength_run"));
    expect(trainTotals.kcal - restTotals.kcal).toBeGreaterThan(300);
  });

  it("rounds kcal/protein to integers", () => {
    const totals = sumSlotMacros(templateSlotsForDayType("strength_run"));
    expect(Number.isInteger(totals.kcal)).toBe(true);
    expect(Number.isInteger(totals.protein)).toBe(true);
  });
});

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
