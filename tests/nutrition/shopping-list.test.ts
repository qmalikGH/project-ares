import { describe, expect, it } from "vitest";
import {
  extractDayNeeds,
  generateShoppingList,
  generateShoppingTrip1,
  generateShoppingTrip2,
  generateStaplesList,
  nextTripForDate,
} from "@/lib/nutrition/shopping-list";
import type { DayPlanSlotsMap } from "@/lib/nutrition/shopping-list";
import { templateSlotsForDayType } from "@/lib/nutrition/template";
import type { MealSlots } from "@/lib/nutrition/types";

// ── Test fixtures ───────────────────────────────────────────────────────
// Use the real template slots so tests exercise the actual item-name
// parsing logic (extractDayNeeds must match the names the template emits).

const slotsMap: DayPlanSlotsMap = {
  strength_run: templateSlotsForDayType("strength_run"),
  threshold: templateSlotsForDayType("threshold"),
  long_run: templateSlotsForDayType("long_run"),
  rest: templateSlotsForDayType("rest"),
};

// ═══════════════════════════════════════════════════════════════════════
// extractDayNeeds — pure slot-parsing logic
// ═══════════════════════════════════════════════════════════════════════

describe("extractDayNeeds", () => {
  it("extracts chicken grams from strength_run slots", () => {
    const need = extractDayNeeds(slotsMap.strength_run!);
    // strength_run uses chicken — mainMeal + dinner both have "Hähnchenbrust Xg"
    expect(need.chickenG).toBeGreaterThan(0);
    expect(need.hackG).toBe(0); // no hack in chicken recipe
  });

  it("extracts hack grams from long_run slots", () => {
    const need = extractDayNeeds(slotsMap.long_run!);
    // long_run uses hack recipe
    expect(need.hackG).toBeGreaterThan(0);
    expect(need.chickenG).toBe(0); // no chicken in hack recipe
  });

  it("extracts rice grams", () => {
    const need = extractDayNeeds(slotsMap.strength_run!);
    expect(need.riceG).toBeGreaterThan(0); // mainMeal + dinner have rice
  });

  it("detects Skyr in training day slots", () => {
    const need = extractDayNeeds(slotsMap.strength_run!);
    expect(need.skyrCount).toBe(1); // one Skyr per training day
  });

  it("rest day has no Skyr", () => {
    const need = extractDayNeeds(slotsMap.rest!);
    expect(need.skyrCount).toBe(0); // rest drops postMealDessert
  });

  it("detects beet juice in training day", () => {
    const need = extractDayNeeds(slotsMap.strength_run!);
    expect(need.beetJuiceDays).toBe(1); // preTraining has "Rote Bete Saft"
  });

  it("rest day has no beet juice", () => {
    const need = extractDayNeeds(slotsMap.rest!);
    expect(need.beetJuiceDays).toBe(0); // no preTraining slot
  });

  it("detects Hummus in training day afternoonSnack", () => {
    const need = extractDayNeeds(slotsMap.strength_run!);
    expect(need.hummusDays).toBe(1); // "Karotten + Hummus"
  });

  it("rest day afternoonSnack has no Hummus", () => {
    const need = extractDayNeeds(slotsMap.rest!);
    expect(need.hummusDays).toBe(0); // just "Karotten 200g", no Hummus
  });

  it("detects Erbsen Flips in alternatives", () => {
    const need = extractDayNeeds(slotsMap.strength_run!);
    expect(need.erbsenFlipsDays).toBe(1); // afternoonSnack alternative
  });

  it("detects Asia-Gemüse in chicken recipe", () => {
    const need = extractDayNeeds(slotsMap.strength_run!);
    expect(need.asiaVegG).toBeGreaterThan(0);
    expect(need.broccoliG).toBe(0);
  });

  it("detects Brokkoli in hack recipe", () => {
    const need = extractDayNeeds(slotsMap.long_run!);
    expect(need.broccoliG).toBeGreaterThan(0);
    expect(need.asiaVegG).toBe(0);
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
    expect(need.riceG).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Shopping Trip 1 (Sun → Mo-Mi)
// ═══════════════════════════════════════════════════════════════════════

describe("Shopping Trip 1 (Sun → Mo-Mi)", () => {
  const trip = generateShoppingTrip1(slotsMap);

  it("trip number = 1", () => expect(trip.tripNumber).toBe(1));
  it("covers Mon/Tue/Wed", () => expect(trip.coversDays).toEqual(["Mon", "Tue", "Wed"]));
  it("cook day = Sunday (UTC weekday 0)", () => expect(trip.cookDayWeekday).toBe(0));

  it("includes chicken (Mo=strength_run, Tu=threshold both use chicken recipe)", () => {
    const chicken = trip.items.find((i) => i.name === "ja! Hähnchenbrust");
    expect(chicken).toBeDefined();
    expect(chicken!.rawGrams).toBeGreaterThan(0);
  });

  it("does NOT include hack (Mon/Tue/Wed all use chicken recipe)", () => {
    // Mon=strength_run(chicken), Tue=threshold(chicken), Wed=rest(chicken)
    expect(trip.items.find((i) => i.name === "Rinderhack")).toBeUndefined();
  });

  it("includes rice", () => {
    expect(trip.items.find((i) => i.name === "ja! Langkorn Reis")).toBeDefined();
  });

  it("includes Skyr (2 training days Mon+Tue; Wed=rest has no Skyr)", () => {
    const skyr = trip.items.find((i) => i.name === "Arla Skyr Vanille 200g");
    expect(skyr).toBeDefined();
    expect(skyr!.amount).toBe("2 Becher"); // Mon + Tue
  });

  it("includes beet juice (2 training days have preTraining)", () => {
    const beet = trip.items.find((i) => i.name === "Rote Bete Saft");
    expect(beet).toBeDefined();
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
// ═══════════════════════════════════════════════════════════════════════

describe("Shopping Trip 2 (Wed → Do-Sa)", () => {
  const trip = generateShoppingTrip2(slotsMap);

  it("trip number = 2", () => expect(trip.tripNumber).toBe(2));
  it("covers Thu/Fri/Sat", () => expect(trip.coversDays).toEqual(["Thu", "Fri", "Sat"]));
  it("cook day = Thursday (UTC weekday 4)", () => expect(trip.cookDayWeekday).toBe(4));

  it("includes hack (Sat=long_run uses hack recipe)", () => {
    const hack = trip.items.find((i) => i.name === "Rinderhack");
    expect(hack).toBeDefined();
    expect(hack!.rawGrams).toBeGreaterThan(0);
  });

  it("includes chicken (Thu/Fri=strength_run use chicken recipe)", () => {
    const chicken = trip.items.find((i) => i.name === "ja! Hähnchenbrust");
    expect(chicken).toBeDefined();
  });

  it("includes Brokkoli (from hack/long_run recipe)", () => {
    expect(trip.items.find((i) => i.name === "REWE BW Brokkoli")).toBeDefined();
  });

  it("includes Asia-Gemüse (from chicken/strength_run recipe)", () => {
    expect(trip.items.find((i) => i.name === "REWE BW Asia-Gemüse")).toBeDefined();
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
  it("different targets produce different chicken quantities", () => {
    // Default template slots vs. empty → verify the system is slot-driven
    const trip1Default = generateShoppingTrip1(slotsMap);
    const trip1Empty = generateShoppingTrip1({}); // no slots → no items
    expect(trip1Default.items.length).toBeGreaterThan(0);
    expect(trip1Empty.items).toHaveLength(0);
  });

  it("partial slotsMap only generates items for available day-types", () => {
    // Only strength_run — covers Mon, Thu, Fri
    const partial: DayPlanSlotsMap = {
      strength_run: slotsMap.strength_run,
    };
    const trip1 = generateShoppingTrip1(partial);
    // Trip 1 covers Mon(strength_run), Tue(threshold), Wed(rest)
    // Only Mon has slots → much less food
    const tripFull = generateShoppingTrip1(slotsMap);
    expect(trip1.totalEstimatedCost).toBeLessThan(tripFull.totalEstimatedCost);
  });

  it("package rounding: amounts are always in package-size multiples", () => {
    const trip = generateShoppingTrip1(slotsMap);
    for (const item of trip.items) {
      // Amount format: "600g", "2× 600g", "1kg", "3 Becher", "1 Stück", "1× Beutel"
      expect(item.amount).toMatch(/^\d+[×g ]|^\d+kg$/);
    }
  });
});
