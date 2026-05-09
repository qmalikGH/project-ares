// Shopping list generator — Sprint v0.16 Phase B4.
// Two weekly trips (Sun → Mo-Mi prep, Wed → Do-Sa prep) plus a periodic
// staples list for items that last 2-4 weeks. Quantities reflect Q's
// 1-person, 1-pan, meal-prep-for-3 setup.

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
  amount: string; // "750g", "3 Stück", "1 Beutel"
  category: ShoppingCategory;
  estimatedCostEur: number;
  store: Store;
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
  label: string; // "Vorrats-Items (alle 2-4 Wochen)"
  items: ShoppingItem[];
  totalEstimatedCost: number;
}

// ── Static template data ─────────────────────────────────────────────────
// Quantities verified against Phase B3 recipes: 750g chicken / 450g rice /
// 750g TK-Asia for the chicken recipe (Trip 1), 750g hack / 750g brokkoli
// for the hack recipe (Trip 2). Snacks scaled to days covered.

const TRIP_1_ITEMS: ShoppingItem[] = [
  // PROTEIN
  { name: "ja! Hähnchenbrust", amount: "600g", category: "PROTEIN", estimatedCostEur: 5.49, store: "ja" },
  { name: "Eier (10er Pack)", amount: "10 Stück", category: "PROTEIN", estimatedCostEur: 2.49, store: "ja" },
  // CARBS
  { name: "ja! Langkorn Reis", amount: "1kg", category: "CARBS", estimatedCostEur: 1.89, store: "ja" },
  { name: "Haferflocken", amount: "500g", category: "CARBS", estimatedCostEur: 0.79, store: "ja" },
  // TK-GEMÜSE
  { name: "REWE BW Asia-Gemüse", amount: "750g", category: "TK-GEMÜSE", estimatedCostEur: 1.79, store: "rewe" },
  // SNACKS
  { name: "Snack-Karotten", amount: "500g", category: "SNACKS", estimatedCostEur: 1.09, store: "rewe" },
  { name: "Hummus klein 150g", amount: "3× 150g", category: "SNACKS", estimatedCostEur: 4.47, store: "rewe" },
  { name: "Arla Skyr Vanille 200g", amount: "3× 200g", category: "MILCHPRODUKTE", estimatedCostEur: 3.57, store: "rewe" },
  // GETRÄNKE
  { name: "Rote Bete Saft", amount: "500ml", category: "GETRÄNKE", estimatedCostEur: 1.49, store: "rewe" },
  { name: "Ingwer", amount: "1 Stück", category: "GETRÄNKE", estimatedCostEur: 0.69, store: "rewe" },
];

const TRIP_2_ITEMS: ShoppingItem[] = [
  // PROTEIN
  { name: "Rinderhack", amount: "500g", category: "PROTEIN", estimatedCostEur: 4.29, store: "rewe" },
  // TK-GEMÜSE
  { name: "REWE BW Brokkoli", amount: "750g", category: "TK-GEMÜSE", estimatedCostEur: 1.69, store: "rewe" },
  // SNACKS
  { name: "Snack-Karotten", amount: "500g", category: "SNACKS", estimatedCostEur: 1.09, store: "rewe" },
  { name: "Hummus klein 150g", amount: "2× 150g", category: "SNACKS", estimatedCostEur: 2.98, store: "rewe" },
  { name: "Arla Skyr Vanille 200g", amount: "3× 200g", category: "MILCHPRODUKTE", estimatedCostEur: 3.57, store: "rewe" },
  { name: "Koro Erbsen Flips", amount: "1× Beutel", category: "SNACKS", estimatedCostEur: 3.0, store: "online" },
  // GETRÄNKE
  { name: "Rote Bete Saft", amount: "500ml", category: "GETRÄNKE", estimatedCostEur: 1.49, store: "rewe" },
];

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

export function generateShoppingTrip1(): ShoppingTrip {
  return {
    tripNumber: 1,
    label: "Sonntag (Mo-Mi)",
    cookDayWeekday: 0,
    coversDays: ["Mon", "Tue", "Wed"],
    items: TRIP_1_ITEMS,
    totalEstimatedCost: totalCost(TRIP_1_ITEMS),
  };
}

export function generateShoppingTrip2(): ShoppingTrip {
  return {
    tripNumber: 2,
    label: "Mittwoch (Do-Sa)",
    cookDayWeekday: 4,
    coversDays: ["Thu", "Fri", "Sat"],
    items: TRIP_2_ITEMS,
    totalEstimatedCost: totalCost(TRIP_2_ITEMS),
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
 * Both weekly trips. Shopping is static — derived from the recipe schedule
 * and Q's per-day snack counts, not from the live MealPlan. When the coach
 * customizes a slot the trip stays unchanged; only the staples list grows.
 */
export function generateShoppingList(): ShoppingTrip[] {
  return [generateShoppingTrip1(), generateShoppingTrip2()];
}

/**
 * Pick the next trip Q should shop for, given today's UTC weekday. Used by
 * the /nutrition UI to decide which list to surface.
 *   Sun, Mon-Tue → Trip 1 (cook on Sun)
 *   Wed, Thu-Sat → Trip 2 (cook on Wed)
 */
export function nextTripForDate(date: Date): ShoppingTrip {
  const d = date.getUTCDay();
  // 0 (Sun) and 1-2 (Mon-Tue) → Trip 1 still relevant
  // 3-6 (Wed-Sat) → Trip 2
  return d === 0 || d === 1 || d === 2
    ? generateShoppingTrip1()
    : generateShoppingTrip2();
}
