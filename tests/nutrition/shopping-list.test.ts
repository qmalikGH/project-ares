import { describe, expect, it } from "vitest";
import {
  extractDayNeeds,
  generateShoppingList,
  generateShoppingTrip1,
  generateShoppingTrip2,
  generateStaplesList,
  nextTripForDate,
} from "@/lib/nutrition/shopping-list";
import type { WeekdaySlotsMap } from "@/lib/nutrition/shopping-list";
import { buildWeekdaySlotsMap, buildSlotsForWeekday, sumSlotMacros } from "@/lib/nutrition/template";
import { INITIAL_TARGETS, DAY_TYPE_BY_WEEKDAY } from "@/lib/nutrition/day-type";
import type { MealSlots } from "@/lib/nutrition/types";

// ── Test fixtures ───────────────────────────────────────────────────────
// Build weekday-keyed slots with the actual recipe rotation:
//   Mo-Mi → chicken, Do-Sa → hack, So → egg

const slotsMap: Record<number, MealSlots> = buildWeekdaySlotsMap(INITIAL_TARGETS);

// ═══════════════════════════════════════════════════════════════════════
// extractDayNeeds — pure slot-parsing logic
// ═══════════════════════════════════════════════════════════════════════

describe("extractDayNeeds", () => {
  it("extracts chicken grams from Monday (chicken recipe)", () => {
    const need = extractDayNeeds(slotsMap[1]!); // Mon = chicken
    expect(need.chickenG).toBeGreaterThan(0);
    expect(need.hackG).toBe(0);
    expect(need.eggCount).toBe(0);
  });

  it("extracts hack grams from Thursday (hack recipe)", () => {
    const need = extractDayNeeds(slotsMap[4]!); // Thu = hack
    expect(need.hackG).toBeGreaterThan(0);
    expect(need.chickenG).toBe(0);
    expect(need.eggCount).toBe(0);
  });

  it("extracts egg count from Sunday (egg recipe)", () => {
    const need = extractDayNeeds(slotsMap[0]!); // Sun = egg
    expect(need.eggCount).toBeGreaterThan(0);
    expect(need.chickenG).toBe(0);
    expect(need.hackG).toBe(0);
  });

  it("extracts rice grams", () => {
    const need = extractDayNeeds(slotsMap[1]!);
    expect(need.riceG).toBeGreaterThan(0);
  });

  it("detects Skyr in training day slots", () => {
    const need = extractDayNeeds(slotsMap[1]!); // Mon = strength_run
    expect(need.skyrCount).toBe(1);
  });

  it("rest day has no Skyr", () => {
    const need = extractDayNeeds(slotsMap[3]!); // Wed = rest
    expect(need.skyrCount).toBe(0);
  });

  it("detects beet juice in training day", () => {
    const need = extractDayNeeds(slotsMap[1]!);
    expect(need.beetJuiceDays).toBe(1);
  });

  it("rest day has no beet juice", () => {
    const need = extractDayNeeds(slotsMap[3]!); // Wed = rest
    expect(need.beetJuiceDays).toBe(0);
  });

  it("detects Hummus in training day afternoonSnack", () => {
    const need = extractDayNeeds(slotsMap[1]!);
    expect(need.hummusDays).toBe(1);
  });

  it("rest day afternoonSnack has no Hummus", () => {
    const need = extractDayNeeds(slotsMap[3]!); // Wed = rest
    expect(need.hummusDays).toBe(0);
  });

  it("detects Erbsen Flips in alternatives", () => {
    const need = extractDayNeeds(slotsMap[1]!); // training day
    expect(need.erbsenFlipsDays).toBe(1);
  });

  it("detects Asia-Gemüse in chicken recipe", () => {
    const need = extractDayNeeds(slotsMap[1]!); // Mon = chicken
    expect(need.asiaVegG).toBeGreaterThan(0);
  });

  it("detects Brokkoli in hack recipe", () => {
    const need = extractDayNeeds(slotsMap[4]!); // Thu = hack
    expect(need.broccoliG).toBeGreaterThan(0);
  });

  it("handles empty slots gracefully", () => {
    const emptySlots: MealSlots = {
      morning: { items: [] },
      preTraining: { items: [] },
      mainMeal: { items: [] },
      postMealDessert: { items: [] },
      afternoonSnack: { items: [] },
      dinner: { items: [] },
      eveningSnack: { items: [] },
    };
    const need = extractDayNeeds(emptySlots);
    expect(need.chickenG).toBe(0);
    expect(need.hackG).toBe(0);
    expect(need.eggCount).toBe(0);
    expect(need.riceG).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Recipe rotation validation — the core fix
// ═══════════════════════════════════════════════════════════════════════

describe("Recipe rotation per weekday", () => {
  it("Mon-Wed slots contain chicken, not hack", () => {
    for (const wd of [1, 2, 3]) {
      const need = extractDayNeeds(slotsMap[wd]!);
      expect(need.chickenG).toBeGreaterThan(0);
      expect(need.hackG).toBe(0);
      expect(need.eggCount).toBe(0);
    }
  });

  it("Thu-Sat slots contain hack, not chicken", () => {
    for (const wd of [4, 5]) {
      const need = extractDayNeeds(slotsMap[wd]!);
      expect(need.hackG).toBeGreaterThan(0);
      expect(need.chickenG).toBe(0);
      expect(need.eggCount).toBe(0);
    }
    // Sat = long_run = hack
    const satNeed = extractDayNeeds(slotsMap[6]!);
    expect(satNeed.hackG).toBeGreaterThan(0);
    expect(satNeed.chickenG).toBe(0);
  });

  it("Sunday slots contain eggs, not chicken or hack", () => {
    const need = extractDayNeeds(slotsMap[0]!);
    expect(need.eggCount).toBeGreaterThan(0);
    expect(need.chickenG).toBe(0);
    expect(need.hackG).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Shopping Trip 1 (Sun → Mo-Mi) — should have ONLY chicken, no hack
// ═══════════════════════════════════════════════════════════════════════

describe("Shopping Trip 1 (Sun → Mo-Mi)", () => {
  const trip = generateShoppingTrip1(slotsMap);

  it("trip number = 1", () => expect(trip.tripNumber).toBe(1));
  it("covers Mon/Tue/Wed", () => expect(trip.coversDays).toEqual(["Mon", "Tue", "Wed"]));
  it("cook day = Sunday (UTC weekday 0)", () => expect(trip.cookDayWeekday).toBe(0));

  it("includes chicken (Mon/Tue/Wed all use chicken recipe)", () => {
    const chicken = trip.items.find((i) => i.name === "ja! Hähnchenbrust");
    expect(chicken).toBeDefined();
    expect(chicken!.rawGrams).toBeGreaterThan(0);
  });

  it("does NOT include hack (Mon-Wed are all chicken)", () => {
    expect(trip.items.find((i) => i.name === "Rinderhack")).toBeUndefined();
  });

  it("does NOT include eggs (no Sunday in trip 1 coverage)", () => {
    expect(trip.items.find((i) => i.name === "Eier Freiland 10er")).toBeUndefined();
  });

  it("includes rice", () => {
    expect(trip.items.find((i) => i.name === "ja! Langkorn Reis")).toBeDefined();
  });

  it("includes Skyr (2 training days Mon+Tue; Wed=rest has no Skyr)", () => {
    const skyr = trip.items.find((i) => i.name === "Arla Skyr Vanille 200g");
    expect(skyr).toBeDefined();
    expect(skyr!.amount).toBe("2 Becher");
  });

  it("all items have positive cost", () => {
    for (const item of trip.items) {
      expect(item.estimatedCostEur).toBeGreaterThan(0);
    }
  });

  it("total cost is positive", () => {
    expect(trip.totalEstimatedCost).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Shopping Trip 2 (Wed → Do-Sa) — should have ONLY hack, no chicken
// ═══════════════════════════════════════════════════════════════════════

describe("Shopping Trip 2 (Wed → Do-Sa)", () => {
  const trip = generateShoppingTrip2(slotsMap);

  it("trip number = 2", () => expect(trip.tripNumber).toBe(2));
  it("covers Thu/Fri/Sat", () => expect(trip.coversDays).toEqual(["Thu", "Fri", "Sat"]));
  it("cook day = Thursday (UTC weekday 4)", () => expect(trip.cookDayWeekday).toBe(4));

  it("includes hack (Thu-Sat use hack recipe)", () => {
    const hack = trip.items.find((i) => i.name === "Rinderhack");
    expect(hack).toBeDefined();
    expect(hack!.rawGrams).toBeGreaterThan(0);
  });

  it("does NOT include chicken (Thu-Sat are all hack)", () => {
    expect(trip.items.find((i) => i.name === "ja! Hähnchenbrust")).toBeUndefined();
  });

  it("includes Brokkoli (from hack recipe)", () => {
    expect(trip.items.find((i) => i.name === "REWE BW Brokkoli")).toBeDefined();
  });

  it("does NOT include Asia-Gemüse (that's the chicken recipe veg)", () => {
    expect(trip.items.find((i) => i.name === "REWE BW Asia-Gemüse")).toBeUndefined();
  });

  it("includes 3× Skyr (Thu+Fri+Sat are all training days)", () => {
    const skyr = trip.items.find((i) => i.name === "Arla Skyr Vanille 200g");
    expect(skyr).toBeDefined();
    expect(skyr!.amount).toBe("3 Becher");
  });

  it("total cost is positive", () => {
    expect(trip.totalEstimatedCost).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Staples (monthly, no slot dependency)
// ═══════════════════════════════════════════════════════════════════════

describe("Staples list (2-4 week interval)", () => {
  const staples = generateStaplesList();

  it("contains supplements", () => {
    expect(staples.items.some((i) => i.name === "HEJ Protein Bars")).toBe(true);
    expect(staples.items.some((i) => i.name === "Whey Isolate")).toBe(true);
    expect(staples.items.some((i) => i.name === "Creatine")).toBe(true);
  });

  it("contains pantry items", () => {
    expect(staples.items.some((i) => i.name === "Sojasauce")).toBe(true);
    expect(staples.items.some((i) => i.name === "Rapsöl")).toBe(true);
  });

  it("most supplements are online", () => {
    const supps = staples.items.filter((i) => i.category === "SUPPLEMENTS");
    expect(supps.every((i) => i.store === "online")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// generateShoppingList — both trips
// ═══════════════════════════════════════════════════════════════════════

describe("generateShoppingList", () => {
  it("returns both trips in order", () => {
    const trips = generateShoppingList(slotsMap);
    expect(trips).toHaveLength(2);
    expect(trips[0].tripNumber).toBe(1);
    expect(trips[1].tripNumber).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// nextTripForDate — weekday routing
// ═══════════════════════════════════════════════════════════════════════

describe("nextTripForDate", () => {
  it("Sunday → Trip 1 (cook day)", () => {
    expect(nextTripForDate(new Date("2026-05-10T00:00:00.000Z"), slotsMap).tripNumber).toBe(1);
  });

  it("Monday → Trip 1", () => {
    expect(nextTripForDate(new Date("2026-05-04T00:00:00.000Z"), slotsMap).tripNumber).toBe(1);
  });

  it("Tuesday → Trip 1", () => {
    expect(nextTripForDate(new Date("2026-05-05T00:00:00.000Z"), slotsMap).tripNumber).toBe(1);
  });

  it("Wednesday → Trip 2 (cook day)", () => {
    expect(nextTripForDate(new Date("2026-05-06T00:00:00.000Z"), slotsMap).tripNumber).toBe(2);
  });

  it("Thursday → Trip 2", () => {
    expect(nextTripForDate(new Date("2026-05-07T00:00:00.000Z"), slotsMap).tripNumber).toBe(2);
  });

  it("Saturday → Trip 2", () => {
    expect(nextTripForDate(new Date("2026-05-09T00:00:00.000Z"), slotsMap).tripNumber).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Slot-derived adaptation — shopping list reflects calibration changes
// ═══════════════════════════════════════════════════════════════════════

describe("Shopping adapts to slot changes", () => {
  it("empty slotsMap produces no items", () => {
    const trip1Empty = generateShoppingTrip1({});
    expect(trip1Empty.items).toHaveLength(0);
  });

  it("partial slotsMap only generates items for available weekdays", () => {
    const partial: WeekdaySlotsMap = {
      1: slotsMap[1], // only Monday
    };
    const trip1 = generateShoppingTrip1(partial);
    const tripFull = generateShoppingTrip1(slotsMap);
    expect(trip1.totalEstimatedCost).toBeLessThan(tripFull.totalEstimatedCost);
  });

  it("package rounding: amounts are always in package-size multiples", () => {
    const trip = generateShoppingTrip1(slotsMap);
    for (const item of trip.items) {
      expect(item.amount).toMatch(/^\d+[×g ]|^\d+kg$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Calorie tolerance — slot sums must stay within 50 kcal of target
// ═══════════════════════════════════════════════════════════════════════

describe("Slot-sum calorie tolerance (all weekdays)", () => {
  for (let wd = 0; wd <= 6; wd++) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayType = DAY_TYPE_BY_WEEKDAY[wd];
    const target = INITIAL_TARGETS[dayType as keyof typeof INITIAL_TARGETS].calorieTarget;

    it(`${dayNames[wd]} (${dayType}): slot sum within 50 kcal of ${target}`, () => {
      const totals = sumSlotMacros(slotsMap[wd]!);
      expect(Math.abs(totals.kcal - target)).toBeLessThanOrEqual(50);
    });
  }
});
