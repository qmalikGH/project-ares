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
import { buildWeekdaySlotsMap, sumSlotMacros } from "@/lib/nutrition/template";
import { INITIAL_TARGETS, DAY_TYPE_BY_WEEKDAY } from "@/lib/nutrition/day-type";
import type { MealSlots } from "@/lib/nutrition/types";

// ── Test fixtures ───────────────────────────────────────────────────────
// Build weekday-keyed slots with v1.2 recipe assignment:
//   strength_run (Mo,Do,Fr): chicken mainMeal + egg dinner (no rice)
//   threshold (Di): chicken mainMeal + egg+chicken+rice dinner (Lösung C)
//   long_run (Sa): hack mainMeal + egg+rice+brokkoli dinner
//   rest (Mi,So): egg mainMeal (no rice) + chicken+rice+brokkoli dinner

const slotsMap: Record<number, MealSlots> = buildWeekdaySlotsMap(INITIAL_TARGETS);

// ═══════════════════════════════════════════════════════════════════════
// extractDayNeeds — pure slot-parsing logic (v2: dual recipes per day)
// ═══════════════════════════════════════════════════════════════════════

describe("extractDayNeeds", () => {
  it("Monday (strength_run): chicken in mainMeal + eggs in dinner", () => {
    const need = extractDayNeeds(slotsMap[1]!);
    expect(need.chickenG).toBeGreaterThan(0);
    expect(need.eggCount).toBeGreaterThan(0); // dinner uses eggs
    expect(need.hackG).toBe(0);
  });

  it("Thursday (strength_run): same as Monday — chicken + eggs", () => {
    const need = extractDayNeeds(slotsMap[4]!);
    expect(need.chickenG).toBeGreaterThan(0);
    expect(need.eggCount).toBeGreaterThan(0);
    expect(need.hackG).toBe(0);
  });

  it("Saturday (long_run): hack mainMeal + chicken dinner", () => {
    const need = extractDayNeeds(slotsMap[6]!);
    expect(need.hackG).toBeGreaterThan(0);
    expect(need.chickenG).toBeGreaterThan(0);
    expect(need.eggCount).toBe(0);
  });

  it("Sunday (rest): egg mainMeal (no rice) + chicken dinner (v1.2)", () => {
    const need = extractDayNeeds(slotsMap[0]!);
    expect(need.eggCount).toBeGreaterThan(0);
    expect(need.chickenG).toBeGreaterThan(0); // v1.2: chicken dinner instead of hack
    expect(need.hackG).toBe(0);
  });

  it("extracts rice grams (mainMeal only, dinner has no rice)", () => {
    const need = extractDayNeeds(slotsMap[1]!);
    expect(need.riceG).toBeGreaterThan(0);
  });

  it("Skyr present on ALL day types (v2: rest day gets Skyr)", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const need = extractDayNeeds(slotsMap[wd]!);
      expect(need.skyrCount, `weekday ${wd}`).toBe(1);
    }
  });

  it("beet juice on training days, not rest", () => {
    // Mon (training) has beet juice
    expect(extractDayNeeds(slotsMap[1]!).beetJuiceDays).toBe(1);
    // Wed (rest) has NO beet juice
    expect(extractDayNeeds(slotsMap[3]!).beetJuiceDays).toBe(0);
  });

  it("Hummus present on ALL day types (v2 afternoon snack)", () => {
    for (let wd = 0; wd <= 6; wd++) {
      const need = extractDayNeeds(slotsMap[wd]!);
      expect(need.hummusDays, `weekday ${wd}`).toBe(1);
    }
  });

  it("detects Asia-Gemüse in chicken/egg mainMeal days", () => {
    const need = extractDayNeeds(slotsMap[1]!); // Mon = chicken + asia veg
    expect(need.asiaVegG).toBeGreaterThan(0);
  });

  it("detects Brokkoli in hack/brokkoli recipes", () => {
    const need = extractDayNeeds(slotsMap[6]!); // Sat = hack+brokkoli mainMeal + egg+brokkoli dinner
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
// v2 recipe assignment validation
// ═══════════════════════════════════════════════════════════════════════

describe("v2 recipe assignment per weekday", () => {
  it("strength_run days (Mo,Do,Fr) have chicken + eggs", () => {
    for (const wd of [1, 4, 5]) {
      const need = extractDayNeeds(slotsMap[wd]!);
      expect(need.chickenG).toBeGreaterThan(0);
      expect(need.eggCount).toBeGreaterThan(0);
      expect(need.hackG).toBe(0);
    }
  });

  it("threshold day (Tue) has chicken + eggs", () => {
    const need = extractDayNeeds(slotsMap[2]!);
    expect(need.chickenG).toBeGreaterThan(0);
    expect(need.eggCount).toBeGreaterThan(0);
    expect(need.hackG).toBe(0);
  });

  it("long_run (Sat) has hack + chicken", () => {
    const need = extractDayNeeds(slotsMap[6]!);
    expect(need.hackG).toBeGreaterThan(0);
    expect(need.chickenG).toBeGreaterThan(0);
    expect(need.eggCount).toBe(0);
  });

  it("rest days (Wed, Sun) have eggs + chicken (v1.2: Hähnchen statt Hack)", () => {
    for (const wd of [0, 3]) {
      const need = extractDayNeeds(slotsMap[wd]!);
      expect(need.eggCount).toBeGreaterThan(0);
      expect(need.chickenG).toBeGreaterThan(0);
      expect(need.hackG).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Shopping Trip 1 (Sun → Mo-Mi)
// v2: Mo=chicken+egg, Di=chicken+egg, Mi=egg+hack
// ═══════════════════════════════════════════════════════════════════════

describe("Shopping Trip 1 (Sun → Mo-Mi)", () => {
  const trip = generateShoppingTrip1(slotsMap);

  it("trip number = 1", () => expect(trip.tripNumber).toBe(1));
  it("covers Mon/Tue/Wed", () => expect(trip.coversDays).toEqual(["Mon", "Tue", "Wed"]));
  it("cook day = Sunday (UTC weekday 0)", () => expect(trip.cookDayWeekday).toBe(0));

  it("includes chicken (Mo+Di mainMeal)", () => {
    const chicken = trip.items.find((i) => i.name === "ja! Hähnchenbrust");
    expect(chicken).toBeDefined();
    expect(chicken!.rawGrams).toBeGreaterThan(0);
  });

  it("includes eggs (dinner on all 3 days + Mi mainMeal)", () => {
    const eggs = trip.items.find((i) => i.name === "Eier Freiland 10er");
    expect(eggs).toBeDefined();
  });

  it("includes chicken for Mi rest-day dinner (v1.2: Hähnchen statt Hack)", () => {
    // v1.2: Rest-day dinner is chicken_rice_brokkoli, so all 3 days have chicken
    const chicken = trip.items.find((i) => i.name === "ja! Hähnchenbrust");
    expect(chicken).toBeDefined();
  });

  it("includes rice (mainMeal recipes have rice)", () => {
    expect(trip.items.find((i) => i.name === "ja! Langkorn Reis")).toBeDefined();
  });

  it("includes Skyr for all 3 days (v2: rest day has Skyr)", () => {
    const skyr = trip.items.find((i) => i.name === "Arla Skyr Vanille 200g");
    expect(skyr).toBeDefined();
    expect(skyr!.amount).toBe("3 Becher");
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
// Shopping Trip 2 (Wed → Do-Sa)
// v2: Do=chicken+egg, Fr=chicken+egg, Sa=hack+egg
// ═══════════════════════════════════════════════════════════════════════

describe("Shopping Trip 2 (Wed → Do-Sa)", () => {
  const trip = generateShoppingTrip2(slotsMap);

  it("trip number = 2", () => expect(trip.tripNumber).toBe(2));
  it("covers Thu/Fri/Sat", () => expect(trip.coversDays).toEqual(["Thu", "Fri", "Sat"]));
  it("cook day = Thursday (UTC weekday 4)", () => expect(trip.cookDayWeekday).toBe(4));

  it("includes chicken (Do+Fr mainMeal)", () => {
    const chicken = trip.items.find((i) => i.name === "ja! Hähnchenbrust");
    expect(chicken).toBeDefined();
  });

  it("includes hack (Sa mainMeal)", () => {
    const hack = trip.items.find((i) => i.name === "Rinderhack");
    expect(hack).toBeDefined();
    expect(hack!.rawGrams).toBeGreaterThan(0);
  });

  it("includes eggs (dinner on all 3 days)", () => {
    const eggs = trip.items.find((i) => i.name === "Eier Freiland 10er");
    expect(eggs).toBeDefined();
  });

  it("includes Brokkoli (from Sa hack+brokkoli mainMeal + egg+brokkoli dinner)", () => {
    expect(trip.items.find((i) => i.name === "REWE BW Brokkoli")).toBeDefined();
  });

  it("includes 3× Skyr (all training days, including v2 behavior)", () => {
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
// Slot-derived adaptation — shopping list reflects changes
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
// Calorie tolerance — slot sums must stay within 30 kcal of target (v2)
// ═══════════════════════════════════════════════════════════════════════

describe("Slot-sum calorie tolerance (all weekdays)", () => {
  for (let wd = 0; wd <= 6; wd++) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayType = DAY_TYPE_BY_WEEKDAY[wd];
    const target = INITIAL_TARGETS[dayType as keyof typeof INITIAL_TARGETS].calorieTarget;

    it(`${dayNames[wd]} (${dayType}): slot sum within 30 kcal of ${target}`, () => {
      const totals = sumSlotMacros(slotsMap[wd]!);
      expect(Math.abs(totals.kcal - target)).toBeLessThanOrEqual(30);
    });
  }
});
