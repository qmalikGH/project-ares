import { describe, expect, it } from "vitest";
import {
  generateShoppingList,
  generateShoppingTrip1,
  generateShoppingTrip2,
  generateStaplesList,
  nextTripForDate,
} from "@/lib/nutrition/shopping-list";

describe("Shopping Trip 1 (Sun → Mo-Mi)", () => {
  const trip = generateShoppingTrip1();

  it("trip number = 1", () => expect(trip.tripNumber).toBe(1));
  it("covers Mon/Tue/Wed", () => expect(trip.coversDays).toEqual(["Mon", "Tue", "Wed"]));
  it("cook day = Sunday (UTC weekday 0)", () => expect(trip.cookDayWeekday).toBe(0));

  it("includes Hähnchenbrust 600g", () => {
    expect(trip.items.find((i) => i.name === "ja! Hähnchenbrust")?.amount).toBe("600g");
  });

  it("includes 3× Skyr (one per day)", () => {
    expect(trip.items.find((i) => i.name === "Arla Skyr Vanille 200g")?.amount).toBe("3× 200g");
  });

  it("includes 3× Hummus", () => {
    expect(trip.items.find((i) => i.name === "Hummus klein 150g")?.amount).toBe("3× 150g");
  });

  it("total cost matches Sprint reference (~€23.76 ±0.05)", () => {
    expect(Math.abs(trip.totalEstimatedCost - 23.76)).toBeLessThanOrEqual(0.05);
  });
});

describe("Shopping Trip 2 (Wed → Do-Sa)", () => {
  const trip = generateShoppingTrip2();

  it("trip number = 2", () => expect(trip.tripNumber).toBe(2));
  it("covers Thu/Fri/Sat", () => expect(trip.coversDays).toEqual(["Thu", "Fri", "Sat"]));
  it("cook day = Thursday (UTC weekday 4)", () => expect(trip.cookDayWeekday).toBe(4));

  it("includes Rinderhack 500g", () => {
    expect(trip.items.find((i) => i.name === "Rinderhack")?.amount).toBe("500g");
  });

  it("includes 2× Hummus (Sat is rest, smaller snack)", () => {
    expect(trip.items.find((i) => i.name === "Hummus klein 150g")?.amount).toBe("2× 150g");
  });

  it("includes Koro Erbsen Flips alternative", () => {
    expect(trip.items.find((i) => i.name === "Koro Erbsen Flips")).toBeDefined();
  });

  it("total cost matches Sprint reference (~€18.11 ±0.05)", () => {
    expect(Math.abs(trip.totalEstimatedCost - 18.11)).toBeLessThanOrEqual(0.05);
  });
});

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

describe("generateShoppingList", () => {
  it("returns both trips in order", () => {
    const trips = generateShoppingList();
    expect(trips).toHaveLength(2);
    expect(trips[0].tripNumber).toBe(1);
    expect(trips[1].tripNumber).toBe(2);
  });
});

describe("nextTripForDate", () => {
  it("Sunday → Trip 1 (cook day)", () => {
    expect(nextTripForDate(new Date("2026-05-10T00:00:00.000Z")).tripNumber).toBe(1);
  });

  it("Monday → Trip 1 (still in week)", () => {
    expect(nextTripForDate(new Date("2026-05-04T00:00:00.000Z")).tripNumber).toBe(1);
  });

  it("Tuesday → Trip 1", () => {
    expect(nextTripForDate(new Date("2026-05-05T00:00:00.000Z")).tripNumber).toBe(1);
  });

  it("Wednesday → Trip 2 (cook day)", () => {
    expect(nextTripForDate(new Date("2026-05-06T00:00:00.000Z")).tripNumber).toBe(2);
  });

  it("Thursday → Trip 2", () => {
    expect(nextTripForDate(new Date("2026-05-07T00:00:00.000Z")).tripNumber).toBe(2);
  });

  it("Saturday → Trip 2", () => {
    expect(nextTripForDate(new Date("2026-05-09T00:00:00.000Z")).tripNumber).toBe(2);
  });
});
