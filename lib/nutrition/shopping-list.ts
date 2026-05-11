// Shopping list generator — Sprint v0.16 Phase B4, rewritten v0.17.
// ARCHITECTURE: Quantities are DERIVED from active DayPlan slots, not
// hardcoded. When calibration changes portions or the coach modifies
// a slot, the shopping list automatically reflects the new amounts.
//
// Two weekly trips (Sun → Mo-Mi, Wed → Do-Sa) + periodic staples.
// Quantities are rounded up to REWE package sizes (Verpackungseinheiten).
//
// Slots are WEEKDAY-KEYED (0=Sun..6=Sat), NOT dayType-keyed. This
// ensures the recipe rotation (chicken Mo-Mi, hack Do-Sa, egg So)
// produces correct ingredient aggregation per trip.

import type { MealSlots } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

export type ShoppingCategory =
  | "PROTEIN"
  | "CARBS"
  | "TK-GEMÜSE"
  | "MILCHPRODUKTE"
  | "SNACKS"
  | "GETRÄNKE"
  | "ÖLE & SAUCEN"
  | "SUPPLEMENTS";

export type Store = "rewe" | "ja" | "online" | "edeka";

export interface ShoppingItem {
  name: string;
  amount: string; // "2× 600g", "1× 750g Beutel", "3 Becher"
  category: ShoppingCategory;
  estimatedCostEur: number;
  store: Store;
  /** Exact grams/units needed (before rounding to package size). For debugging. */
  rawGrams?: number;
}

export type TripNumber = 1 | 2;

export interface ShoppingTrip {
  tripNumber: TripNumber;
  label: string; // "Sonntag (Mo-Mi)" | "Mittwoch (Do-Sa)"
  cookDayWeekday: number; // JS getUTCDay(): 0=Sun, 4=Thu
  coversDays: string[]; // human-readable: ["Mon", "Tue", "Wed"]
  items: ShoppingItem[];
  totalEstimatedCost: number;
}

export interface StaplesList {
  label: string;
  items: ShoppingItem[];
  totalEstimatedCost: number;
}

// ── REWE package definitions ─────────────────────────────────────────────
// Real REWE prices + package sizes as of May 2026.

interface PackageDef {
  name: string;
  packageG: number; // grams per package
  priceEur: number;
  category: ShoppingCategory;
  store: Store;
}

const PACKAGES = {
  chicken: { name: "ja! Hähnchenbrust", packageG: 600, priceEur: 5.49, category: "PROTEIN" as const, store: "ja" as const },
  hack: { name: "Rinderhack", packageG: 500, priceEur: 4.29, category: "PROTEIN" as const, store: "rewe" as const },
  rice: { name: "ja! Langkorn Reis", packageG: 1000, priceEur: 1.89, category: "CARBS" as const, store: "ja" as const },
  asiaVeg: { name: "REWE BW Asia-Gemüse", packageG: 750, priceEur: 1.79, category: "TK-GEMÜSE" as const, store: "rewe" as const },
  broccoli: { name: "REWE BW Brokkoli", packageG: 750, priceEur: 1.69, category: "TK-GEMÜSE" as const, store: "rewe" as const },
  hummus: { name: "Hummus ja!", packageG: 200, priceEur: 1.0, category: "SNACKS" as const, store: "rewe" as const },
  carrots: { name: "Snack-Karotten", packageG: 500, priceEur: 1.09, category: "SNACKS" as const, store: "rewe" as const },
  skyr: { name: "Arla Skyr Vanille 200g", packageG: 200, priceEur: 1.19, category: "MILCHPRODUKTE" as const, store: "rewe" as const },
  beetJuice: { name: "Rote Bete Saft", packageG: 500, priceEur: 1.49, category: "GETRÄNKE" as const, store: "rewe" as const },
} as const;

// ── Slot item extractors (pure) ──────────────────────────────────────────
// Parse gram amounts from item names like "Hähnchenbrust 250g" or
// "Reis 150g (trocken)". Returns 0 if not found.

function extractGrams(itemName: string): number {
  const match = itemName.match(/(\d+)g/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Extract egg count from item name like "Eier 4 Stück". */
function extractEggCount(itemName: string): number {
  const match = itemName.match(/(\d+)\s*Stück/);
  return match ? parseInt(match[1], 10) : 0;
}

/** True if item name contains a keyword (case-insensitive). */
function nameContains(name: string, keyword: string): boolean {
  return name.toLowerCase().includes(keyword.toLowerCase());
}

// ── Aggregation types ────────────────────────────────────────────────────

interface RawNeed {
  chickenG: number;
  hackG: number;
  eggCount: number; // total eggs (whole units)
  riceG: number;
  asiaVegG: number;
  broccoliG: number;
  hummusDays: number; // number of days that have Hummus-containing snack
  carrotDays: number;
  skyrCount: number; // number of 200g Becher
  beetJuiceDays: number; // days with preTraining slot active
  /** Days with afternoonSnack containing "Erbsen Flips" alternative */
  erbsenFlipsDays: number;
}

function emptyRawNeed(): RawNeed {
  return {
    chickenG: 0,
    hackG: 0,
    eggCount: 0,
    riceG: 0,
    asiaVegG: 0,
    broccoliG: 0,
    hummusDays: 0,
    carrotDays: 0,
    skyrCount: 0,
    beetJuiceDays: 0,
    erbsenFlipsDays: 0,
  };
}

/**
 * Extract raw ingredient needs from a single day's MealSlots.
 * Parses gram amounts from item names and counts presence of items.
 */
export function extractDayNeeds(slots: MealSlots): RawNeed {
  const need = emptyRawNeed();

  const allItems = Object.values(slots).flatMap((s) => s.items);

  for (const item of allItems) {
    const g = extractGrams(item.name);

    // Protein sources
    if (nameContains(item.name, "Hähnchenbrust")) need.chickenG += g;
    else if (nameContains(item.name, "Rinderhack")) need.hackG += g;
    else if (nameContains(item.name, "Eier")) need.eggCount += extractEggCount(item.name);

    // Carbs
    if (nameContains(item.name, "Reis") && nameContains(item.name, "trocken")) need.riceG += g;

    // Vegetables
    if (nameContains(item.name, "Asia-Gemüse")) need.asiaVegG += g;
    else if (nameContains(item.name, "Brokkoli")) need.broccoliG += g;

    // Hummus + Karotten (afternoon snack)
    if (nameContains(item.name, "Hummus")) need.hummusDays += 1;
    if (nameContains(item.name, "Karotten")) need.carrotDays += 1;

    // Skyr
    if (nameContains(item.name, "Skyr")) need.skyrCount += 1;

    // Beet juice (in preTraining)
    if (nameContains(item.name, "Rote Bete")) need.beetJuiceDays += 1;
  }

  // Check for Erbsen Flips in alternatives
  if (slots.afternoonSnack.alternatives?.some((a) => nameContains(a.name, "Erbsen Flips"))) {
    need.erbsenFlipsDays += 1;
  }

  return need;
}

/**
 * Sum RawNeeds from multiple days into a single aggregated need.
 */
function sumNeeds(days: RawNeed[]): RawNeed {
  const total = emptyRawNeed();
  for (const d of days) {
    total.chickenG += d.chickenG;
    total.hackG += d.hackG;
    total.eggCount += d.eggCount;
    total.riceG += d.riceG;
    total.asiaVegG += d.asiaVegG;
    total.broccoliG += d.broccoliG;
    total.hummusDays += d.hummusDays;
    total.carrotDays += d.carrotDays;
    total.skyrCount += d.skyrCount;
    total.beetJuiceDays += d.beetJuiceDays;
    total.erbsenFlipsDays += d.erbsenFlipsDays;
  }
  return total;
}

// ── Package rounding ─────────────────────────────────────────────────────

/** Round up to next package count. E.g. 990g chicken / 600g pack = 2 packs. */
function packagesNeeded(gramsNeeded: number, packageG: number): number {
  if (gramsNeeded <= 0) return 0;
  return Math.ceil(gramsNeeded / packageG);
}

function makeItem(pkg: PackageDef, count: number, rawG?: number): ShoppingItem {
  const amount =
    count === 1
      ? pkg.packageG >= 1000
        ? `${pkg.packageG / 1000}kg`
        : `${pkg.packageG}g`
      : `${count}× ${pkg.packageG >= 1000 ? `${pkg.packageG / 1000}kg` : `${pkg.packageG}g`}`;
  return {
    name: pkg.name,
    amount,
    category: pkg.category,
    estimatedCostEur: Math.round(count * pkg.priceEur * 100) / 100,
    store: pkg.store,
    rawGrams: rawG,
  };
}

function makeCountItem(pkg: PackageDef, count: number): ShoppingItem {
  return {
    name: pkg.name,
    amount: `${count} Becher`,
    category: pkg.category,
    estimatedCostEur: Math.round(count * pkg.priceEur * 100) / 100,
    store: pkg.store,
  };
}

// ── Trip builder (pure) ──────────────────────────────────────────────────

/**
 * Build a shopping trip from aggregated ingredient needs.
 * All quantities are rounded up to the next REWE package size.
 */
function buildTripItems(need: RawNeed): ShoppingItem[] {
  const items: ShoppingItem[] = [];

  // PROTEIN — chicken
  if (need.chickenG > 0) {
    const packs = packagesNeeded(need.chickenG, PACKAGES.chicken.packageG);
    items.push(makeItem(PACKAGES.chicken, packs, need.chickenG));
  }
  // PROTEIN — hack
  if (need.hackG > 0) {
    const packs = packagesNeeded(need.hackG, PACKAGES.hack.packageG);
    items.push(makeItem(PACKAGES.hack, packs, need.hackG));
  }
  // PROTEIN — eggs (10er Packung)
  if (need.eggCount > 0) {
    const packs = Math.ceil(need.eggCount / 10);
    items.push({
      name: "Eier Freiland 10er",
      amount: packs === 1 ? "10 Stück" : `${packs}× 10 Stück`,
      category: "PROTEIN",
      estimatedCostEur: Math.round(packs * 2.29 * 100) / 100,
      store: "rewe",
      rawGrams: need.eggCount, // actually count, not grams
    });
  }

  // CARBS — rice
  if (need.riceG > 0) {
    const packs = packagesNeeded(need.riceG, PACKAGES.rice.packageG);
    items.push(makeItem(PACKAGES.rice, packs, need.riceG));
  }

  // TK-GEMÜSE
  if (need.asiaVegG > 0) {
    const packs = packagesNeeded(need.asiaVegG, PACKAGES.asiaVeg.packageG);
    items.push(makeItem(PACKAGES.asiaVeg, packs, need.asiaVegG));
  }
  if (need.broccoliG > 0) {
    const packs = packagesNeeded(need.broccoliG, PACKAGES.broccoli.packageG);
    items.push(makeItem(PACKAGES.broccoli, packs, need.broccoliG));
  }

  // SNACKS
  if (need.carrotDays > 0) {
    // 200g per snack day → 500g packs
    const gramsNeeded = need.carrotDays * 200;
    const packs = packagesNeeded(gramsNeeded, PACKAGES.carrots.packageG);
    items.push(makeItem(PACKAGES.carrots, packs, gramsNeeded));
  }
  if (need.hummusDays > 0) {
    // 100g per day of Hummus → 200g Becher (1 Becher = 2 Tage)
    const packs = packagesNeeded(need.hummusDays * 100, PACKAGES.hummus.packageG);
    items.push(makeItem(PACKAGES.hummus, packs, need.hummusDays * 100));
  }

  // MILCHPRODUKTE — Skyr (1 Becher per occurrence in slots)
  if (need.skyrCount > 0) {
    items.push(makeCountItem(PACKAGES.skyr, need.skyrCount));
  }

  // GETRÄNKE — Beet juice (200ml per day, 500ml bottle ≈ 2.5 days)
  if (need.beetJuiceDays > 0) {
    const mlNeeded = need.beetJuiceDays * 200;
    const bottles = packagesNeeded(mlNeeded, PACKAGES.beetJuice.packageG);
    items.push(makeItem(PACKAGES.beetJuice, bottles, mlNeeded));
  }

  // Ingwer — 1 Stück per trip if any preTraining days
  if (need.beetJuiceDays > 0) {
    items.push({
      name: "Ingwer",
      amount: "1 Stück",
      category: "GETRÄNKE",
      estimatedCostEur: 0.69,
      store: "rewe",
    });
  }

  // Erbsen Flips — one per trip if any days have the alternative
  if (need.erbsenFlipsDays > 0) {
    items.push({
      name: "Koro Erbsen Flips",
      amount: "1× Beutel",
      category: "SNACKS",
      estimatedCostEur: 3.0,
      store: "online",
    });
  }

  return items;
}

// ── Staples (monthly, not derived from slots) ────────────────────────────

const STAPLES_ITEMS: ShoppingItem[] = [
  // SUPPLEMENTS (online)
  { name: "HEJ Protein Bars", amount: "12er Box", category: "SUPPLEMENTS", estimatedCostEur: 22.44, store: "online" },
  { name: "Whey Isolate", amount: "1kg", category: "SUPPLEMENTS", estimatedCostEur: 25.0, store: "online" },
  { name: "Creatine", amount: "500g", category: "SUPPLEMENTS", estimatedCostEur: 15.0, store: "online" },
  { name: "Kollagen-Peptide", amount: "1× Dose", category: "SUPPLEMENTS", estimatedCostEur: 20.0, store: "online" },
  { name: "Vitamin C", amount: "1× Pack", category: "SUPPLEMENTS", estimatedCostEur: 8.0, store: "online" },
  // PANTRY (rewe)
  { name: "Honig", amount: "250g", category: "ÖLE & SAUCEN", estimatedCostEur: 3.49, store: "rewe" },
  { name: "Sojasauce", amount: "250ml", category: "ÖLE & SAUCEN", estimatedCostEur: 1.79, store: "rewe" },
  { name: "Rapsöl", amount: "500ml", category: "ÖLE & SAUCEN", estimatedCostEur: 2.29, store: "rewe" },
  { name: "Dose Tomaten", amount: "4× 400g", category: "CARBS", estimatedCostEur: 2.36, store: "rewe" },
  { name: "Zwiebeln", amount: "1kg Netz", category: "CARBS", estimatedCostEur: 1.29, store: "rewe" },
];

// ── Public API ────────────────────────────────────────────────────────────

function totalCost(items: ShoppingItem[]): number {
  return Math.round(items.reduce((sum, i) => sum + i.estimatedCostEur, 0) * 100) / 100;
}

/**
 * Weekday-keyed slots map (0=Sun..6=Sat). Each weekday has its own
 * MealSlots with the correct recipe (chicken/hack/egg). Built by
 * `buildWeekdaySlotsMap()` from template.ts.
 */
export type WeekdaySlotsMap = Partial<Record<number, MealSlots>>;

/** @deprecated Use WeekdaySlotsMap instead. Kept for backward compat. */
export type DayPlanSlotsMap = WeekdaySlotsMap;

/** Trip 1 covers Mon (1), Tue (2), Wed (3). */
const TRIP_1_WEEKDAYS = [1, 2, 3] as const;
/** Trip 2 covers Thu (4), Fri (5), Sat (6). */
const TRIP_2_WEEKDAYS = [4, 5, 6] as const;

/**
 * Collect day needs for a set of weekdays, using the weekday-keyed
 * slots map to look up each day's MealSlots directly.
 */
function collectNeeds(weekdays: readonly number[], slotsMap: WeekdaySlotsMap): RawNeed {
  const dayNeeds: RawNeed[] = [];
  for (const wd of weekdays) {
    const slots = slotsMap[wd];
    if (slots) {
      dayNeeds.push(extractDayNeeds(slots));
    }
  }
  return sumNeeds(dayNeeds);
}

export function generateShoppingTrip1(slotsMap: WeekdaySlotsMap): ShoppingTrip {
  const need = collectNeeds(TRIP_1_WEEKDAYS, slotsMap);
  const items = buildTripItems(need);
  return {
    tripNumber: 1,
    label: "Sonntag (Mo-Mi)",
    cookDayWeekday: 0,
    coversDays: ["Mon", "Tue", "Wed"],
    items,
    totalEstimatedCost: totalCost(items),
  };
}

export function generateShoppingTrip2(slotsMap: WeekdaySlotsMap): ShoppingTrip {
  const need = collectNeeds(TRIP_2_WEEKDAYS, slotsMap);
  const items = buildTripItems(need);
  return {
    tripNumber: 2,
    label: "Mittwoch (Do-Sa)",
    cookDayWeekday: 4,
    coversDays: ["Thu", "Fri", "Sat"],
    items,
    totalEstimatedCost: totalCost(items),
  };
}

export function generateStaplesList(): StaplesList {
  return {
    label: "Vorrats-Items (alle 2-4 Wochen)",
    items: STAPLES_ITEMS,
    totalEstimatedCost: totalCost(STAPLES_ITEMS),
  };
}

/**
 * Both weekly trips, derived from weekday-keyed DayPlan slots.
 */
export function generateShoppingList(slotsMap: WeekdaySlotsMap): ShoppingTrip[] {
  return [generateShoppingTrip1(slotsMap), generateShoppingTrip2(slotsMap)];
}

/**
 * Pick the next trip Q should shop for, given today's UTC weekday.
 *   Sun, Mon-Tue → Trip 1 (cook on Sun)
 *   Wed, Thu-Sat → Trip 2 (cook on Wed)
 */
export function nextTripForDate(date: Date, slotsMap: WeekdaySlotsMap): ShoppingTrip {
  const d = date.getUTCDay();
  return d === 0 || d === 1 || d === 2
    ? generateShoppingTrip1(slotsMap)
    : generateShoppingTrip2(slotsMap);
}
