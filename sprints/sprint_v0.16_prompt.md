# Sprint v0.16: Nutrition-Modul + Coaching-Infrastruktur

## Mission

Zwei zusammenhängende Systeme in einem Sprint:

**Teil A — Coaching-Infrastruktur:** Write-Endpoint für externen AI-Coach (Claude Opus), Garmin-Wellness-Sync fixen, Health-Daten korrigieren.

**Teil B — Nutrition-Modul:** Statischer Meal Plan mit Tagestyp-Steuerung, Einkaufsliste, Nächster-Tag-Anpassung basierend auf Garmin-TDEE.

---

# TEIL A: COACHING-INFRASTRUKTUR

---

## Phase A1: Write-Endpoint (1.5h)

### A1.1: Route erstellen

**Datei:** `app/api/coaching-update/route.ts` (neu)

```typescript
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  
  if (!token || token !== process.env.COACHING_EXPORT_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  
  const body = await req.json();
  // body: { action: string, data: any, reason: string }
  
  // ... Action-Router (A1.2)
  
  return NextResponse.json({ success: true, action: body.action, reason: body.reason });
}
```

Gleicher Token wie der Export-Endpoint (`COACHING_EXPORT_TOKEN`). Kein neuer Token nötig.

### A1.2: Action-Router

Unterstützte Actions:

```typescript
type CoachingAction =
  | { action: "updateTherapyPhase"; data: { phase: "REACTIVE" | "DISREPAIR" | "REMODELING" | "SPORT_SPECIFIC" }; reason: string }
  | { action: "updateActiveInjuries"; data: { injuries: string[] }; reason: string }
  | { action: "updatePreventionExercises"; data: { exercises: string[] }; reason: string }
  | { action: "updateMealPlan"; data: MealPlanUpdate; reason: string }
  | { action: "adjustDaySlot"; data: { date: string; slot: string; adjustment: any }; reason: string }
  | { action: "updateCalorieTargets"; data: { dayType: string; calorieTarget: number; macros: { protein: number; carbs: number; fat: number } }; reason: string }
```

### A1.3: Reason-Logging

Jede Action wird in einer neuen Tabelle `CoachingLog` geloggt:

```prisma
model CoachingLog {
  id        String   @id @default(cuid())
  userId    String
  action    String
  data      Json
  reason    String
  createdAt DateTime @default(now())
  
  user      User     @relation(fields: [userId], references: [id])
}
```

**Migration erstellen:** `npx prisma migrate dev --name add-coaching-log`

So kann Q jederzeit nachvollziehen was der Coach geändert hat und warum.

### A1.4: Action-Handler implementieren

Erstelle `lib/coaching-update/handle-action.ts`:

```typescript
export async function handleCoachingAction(
  userId: string,
  action: string,
  data: any,
  reason: string
): Promise<{ success: boolean; error?: string }>
```

Jede Action:
1. Validiert den Input
2. Führt die DB-Änderung aus (Prisma update)
3. Loggt in `CoachingLog`
4. Returned success/error

Beispiel `updateTherapyPhase`:
```typescript
case "updateTherapyPhase":
  await prisma.userSettings.update({
    where: { userId },
    data: { therapyPhase: data.phase }
  });
  break;
```

### A1.5: Tests

- POST ohne Token → 401
- POST mit falschem Token → 401
- POST mit richtigem Token + gültige Action → 200 + DB-Änderung verifizieren
- POST mit unbekannter Action → 400
- CoachingLog-Eintrag wird erstellt
- Ungültige data → 400 mit Fehlermeldung

---

## Phase A2: Garmin-Wellness-Sync fixen (2h)

Aktuell kommen HRV, Sleep, Body Battery und TDEE-Kalorien als `null` zurück. Diese Felder existieren möglicherweise im DailySensorData-Schema, werden aber vom Cron-Job nicht befüllt.

### A2.1: Analyse

Prüfe den bestehenden Garmin-Sync-Code (vermutlich in `lib/garmin/` oder `app/api/cron/`):

1. Welche Garmin-Endpoints werden aktuell aufgerufen?
2. Welche Felder werden in `DailySensorData` geschrieben?
3. Welche Felder existieren im Schema aber bleiben leer?

### A2.2: Fehlende Felder ergänzen

Der `@flow-js/garmin-connect` Client bietet Zugriff auf:

- **HRV:** `GarminConnect.getHRVData(date)` → `hrvRMSSD`, `hrvStatus` (`BALANCED`, `UNBALANCED`, `LOW`)
- **Sleep:** `GarminConnect.getSleepData(date)` → `sleepScore`, `sleepDurationMin`, `sleepStages`
- **Body Battery:** `GarminConnect.getBodyBattery(date)` → `bodyBatteryMorning`, `bodyBatteryEnd`
- **Kalorien:** `GarminConnect.getDailySummary(date)` → `totalKilocalories`, `activeKilocalories`, `bmrKilocalories`
- **Stress:** `GarminConnect.getStressData(date)` → `averageStress`

**WICHTIG:** Prüfe welche Methoden `@flow-js/garmin-connect` tatsächlich anbietet. Die API-Namen oben sind Richtwerte — die tatsächlichen Methodennamen können abweichen. Schaue in `node_modules/@flow-js/garmin-connect` nach den verfügbaren Methoden.

### A2.3: DailySensorData-Schema erweitern (falls nötig)

Falls Felder fehlen, Migration erstellen:

```prisma
model DailySensorData {
  // ... bestehende Felder ...
  
  // Kalorien (NEU falls fehlend)
  totalKilocalories    Int?
  activeKilocalories   Int?
  bmrKilocalories      Int?
  
  // Sleep (NEU falls fehlend) 
  sleepScore           Int?
  sleepDurationMin     Int?
  
  // Body Battery (NEU falls fehlend)
  bodyBatteryMorning   Int?
  bodyBatteryEnd       Int?
  
  // HRV (NEU falls fehlend)
  hrvRMSSD             Float?
  hrvStatus            String?
  
  // Stress (NEU falls fehlend)
  averageStress        Float?
}
```

`npx prisma migrate dev --name add-wellness-fields` (nur für tatsächlich fehlende Felder)

### A2.4: Cron-Job erweitern

Im bestehenden Garmin-Sync-Cron-Job die neuen Felder beim täglichen Sync befüllen. **Fehler-tolerant:** Wenn ein Garmin-Endpoint fehlschlägt (z.B. Sleep nicht verfügbar), die anderen trotzdem speichern.

### A2.5: Coaching-Export aktualisieren

`lib/coaching-export/build-export.ts` → Wellness-Sektion: die neuen Felder aus `DailySensorData` einschließen. Kalorien als eigene Sektion hinzufügen:

```typescript
calories: {
  days: [
    {
      date: string,
      totalKcal: number,
      activeKcal: number,
      bmrKcal: number
    }
  ],
  averageByDayType: {
    strength_run: number,    // Ø TDEE an Mo/Do/Fr
    threshold: number,       // Ø TDEE an Di
    long_run: number,        // Ø TDEE an Sa
    rest: number             // Ø TDEE an Mi/So
  }
}
```

Die `averageByDayType`-Berechnung: Letzte 14 Tage, gruppiert nach Wochentag → Tagestyp-Mapping, Durchschnitt pro Typ.

---

## Phase A3: Health-Daten korrigieren (15min)

Einmalige DB-Korrektur:

```typescript
await prisma.userSettings.update({
  where: { userId: "<Q's userId>" },
  data: {
    therapyPhase: "REMODELING",
    // activeInjuries und preventionExercises — je nach Schema-Typ (String[] oder Json)
  }
});
```

Setze:
- `therapyPhase` = `"REMODELING"`
- `activeInjuries` = `["shin_splints"]` (nicht `patellar_tendinopathy`)
- `preventionExercises` = `["Tibialis Anterior Raises", "Short Foot Exercise", "Single-Leg Calf Raises"]`

Kann als Seed-Script oder direkt im Prisma Studio gemacht werden.

---

# TEIL B: NUTRITION-MODUL

---

## Phase B1: Datenmodell (1h)

### B1.1: Prisma-Schema

```prisma
model MealPlan {
  id        String   @id @default(cuid())
  userId    String
  name      String   // "Block 1 Standard"
  status    String   @default("active")  // "active" | "archived"
  
  // Globale Settings
  budgetPerDay    Float    @default(15.0)
  proteinTarget   Int      // 190
  deficitKcal     Int      @default(500)
  
  // Kalibration
  calibrationStatus  String  @default("pending")  // "pending" | "collecting" | "calibrated"
  calibratedAt       DateTime?
  
  dayPlans    DayPlan[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  user        User     @relation(fields: [userId], references: [id])
}

model DayPlan {
  id          String   @id @default(cuid())
  mealPlanId  String
  dayType     String   // "strength_run" | "threshold" | "long_run" | "rest"
  
  // Kalorien-Targets (initial geschätzt, nach Kalibration aus Garmin)
  tdeeEstimate    Int      // geschätzter TDEE
  calorieTarget   Int      // TDEE - Defizit
  proteinG        Int
  carbsG          Int
  fatG            Int
  
  // Slots als JSON — flexibel erweiterbar
  slots           Json
  // Struktur siehe B1.2
  
  mealPlan    MealPlan @relation(fields: [mealPlanId], references: [id])
}

model DailyNutritionLog {
  id        String   @id @default(cuid())
  userId    String
  date      DateTime @db.Date
  
  // Was war geplant
  dayType         String
  calorieTarget   Int
  
  // Garmin-TDEE (von DailySensorData)
  garminTDEE      Int?
  
  // Anpassung
  adjustment      Json?    // { slot: "skyr", action: "remove", reason: "TDEE gestern 250 unter Plan" }
  
  // Compliance
  followed        Boolean  @default(true)
  notes           String?
  
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])
  
  @@unique([userId, date])
}
```

`npx prisma migrate dev --name add-nutrition-module`

### B1.2: Slot-Struktur (DayPlan.slots JSON)

```typescript
interface MealSlots {
  morning: {
    items: [
      { name: "HEJ Protein Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, costEur: 1.87 },
      { name: "Whey Shake 30g + Creatine", kcal: 120, protein: 25, carbs: 2, fat: 1, costEur: 0.50 }
    ]
  },
  preTraining: {
    // Nur an Trainingstagen
    items: [
      { name: "Rote Bete Saft 200ml", kcal: 80, protein: 0, carbs: 18, fat: 0, costEur: 0.50 },
      { name: "Ingwer + Honig", kcal: 70, protein: 0, carbs: 17, fat: 0, costEur: 0.30 },
      { name: "Kollagen 15g + Vitamin C", kcal: 55, protein: 14, carbs: 0, fat: 0, costEur: 0.40 }
    ]
  },
  mainMeal: {
    recipe: "chicken_rice_tkgemuse" | "hack_rice_tkgemuse" | "egg_rice_tkgemuse",
    items: [
      { name: "Hähnchenbrust 250g", kcal: 275, protein: 55, carbs: 0, fat: 3, costEur: 2.30 },
      { name: "Reis 150g (trocken)", kcal: 540, protein: 10, carbs: 117, fat: 1, costEur: 0.30 },
      { name: "TK Asia-Gemüse 250g", kcal: 60, protein: 3, carbs: 8, fat: 1, costEur: 0.60 },
      { name: "Öl + Sojasauce", kcal: 50, protein: 0, carbs: 1, fat: 5, costEur: 0.15 }
    ]
  },
  postMealDessert: {
    // Flexibler Hebel — kann entfernt werden bei TDEE-Überschuss
    flexible: true,
    items: [
      { name: "Arla Skyr Vanille 200g", kcal: 130, protein: 20, carbs: 14, fat: 0, costEur: 1.19 }
    ]
  },
  afternoonSnack: {
    items: [
      { name: "Karotten + Hummus 150g", kcal: 550, protein: 12, carbs: 30, fat: 25, costEur: 2.00 }
    ],
    // Alternative (1-2x/Woche)
    alternatives: [
      { name: "Koro Erbsen Flips", kcal: 600, protein: 20, carbs: 55, fat: 18, costEur: 3.00, maxPerWeek: 2 }
    ]
  },
  dinner: {
    recipe: "pfanne",  // variiert, gleiche Grundstruktur
    items: [
      // wird aus mainMeal-Rezept oder separatem Abend-Rezept befüllt
    ]
  },
  eveningSnack: {
    items: [
      { name: "HEJ Protein Bar", kcal: 200, protein: 20, carbs: 18, fat: 7, costEur: 1.87 }
    ]
  }
}
```

---

## Phase B2: Tagestyp-Engine (1.5h)

### B2.1: Tagestyp-Mapping

Erstelle `lib/nutrition/day-type.ts`:

```typescript
const DAY_TYPE_MAP: Record<string, string> = {
  Monday: "strength_run",     // Easy + Strength A
  Tuesday: "threshold",       // Threshold/Calibration Run
  Wednesday: "rest",
  Thursday: "strength_run",   // Easy + Strength B
  Friday: "strength_run",     // Easy + Strength C
  Saturday: "long_run",       // Long Run
  Sunday: "rest"
};

export function getDayType(date: Date): string {
  const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
  return DAY_TYPE_MAP[dayName] || "rest";
}
```

### B2.2: Initiale Kalorien-Targets (vor Kalibration)

Geschätzte Werte bis Garmin-TDEE-Daten vorhanden sind:

```typescript
const INITIAL_TARGETS: Record<string, { tdee: number; deficit: number }> = {
  strength_run: { tdee: 3000, deficit: 500 },   // → 2500 kcal
  threshold:    { tdee: 2800, deficit: 500 },   // → 2300 kcal
  long_run:     { tdee: 3200, deficit: 500 },   // → 2700 kcal
  rest:         { tdee: 2200, deficit: 500 }    // → 1700 kcal
};
```

**Diese Werte werden nach der Kalibrierungsphase durch echte Garmin-Durchschnitte ersetzt.**

### B2.3: Tagestyp-spezifische Slot-Variation

Nicht jeder Tag hat alle Slots:

| Slot | S+E | Threshold | Long Run | Rest |
|------|-----|-----------|----------|------|
| Morning (Bar+Shake) | ✓ | ✓ | ✓ | ✓ |
| Pre-Training | ✓ | ✓ | ✓ | ✗ |
| Main Meal + Skyr | ✓ | ✓ | ✓ | ✓ (kein Skyr) |
| Afternoon Snack | ✓ | ✓ | ✓ | ✓ (kleiner) |
| Dinner | ✓ | ✓ | ✓ | ✓ (kleiner) |
| Evening (Bar+Tee) | ✓ | ✓ | ✓ | ✓ |

An Rest-Tagen: kein Pre-Training-Slot, kein Skyr, kleinere Dinner-Portion → ~500 kcal weniger.

---

## Phase B3: Rezepte + Wochenplan (1h)

### B3.1: Rezept-Definitionen

Erstelle `lib/nutrition/recipes.ts`:

```typescript
export const RECIPES = {
  chicken_rice_tkgemuse: {
    name: "Hähnchen-Reis mit TK-Gemüse",
    prepTimeMin: 20,
    servings: 3,  // Meal Prep für 3 Tage
    ingredients: [
      { name: "Hähnchenbrust", amountG: 750, kcalPer100g: 110, proteinPer100g: 23, costEur: 6.87 },
      { name: "Langkorn Reis (trocken)", amountG: 450, kcalPer100g: 360, proteinPer100g: 7, costEur: 0.85 },
      { name: "TK Asia-Gemüse", amountG: 750, kcalPer100g: 25, proteinPer100g: 2, costEur: 1.79 },
      { name: "Rapsöl", amountMl: 15, kcalPerMl: 9, costEur: 0.10 },
      { name: "Sojasauce", amountMl: 30, kcalPerMl: 0.5, costEur: 0.15 }
    ],
    instructions: "Reis kochen. Hähnchen in Streifen schneiden, in Öl anbraten. TK-Gemüse dazu, 5 min braten. Sojasauce. Auf 3 Boxen verteilen.",
    perServing: { kcal: 650, protein: 50, carbs: 65, fat: 12, costEur: 3.25 }
  },
  
  hack_rice_tkgemuse: {
    name: "Hackfleisch-Reis mit TK-Brokkoli",
    prepTimeMin: 20,
    servings: 3,
    ingredients: [
      { name: "Rinderhack", amountG: 750, kcalPer100g: 210, proteinPer100g: 18, costEur: 8.58 },
      { name: "Langkorn Reis (trocken)", amountG: 450, kcalPer100g: 360, proteinPer100g: 7, costEur: 0.85 },
      { name: "TK Brokkoli", amountG: 750, kcalPer100g: 28, proteinPer100g: 3, costEur: 1.69 },
      { name: "Dose Tomaten", amountG: 400, kcalPer100g: 20, proteinPer100g: 1, costEur: 0.59 },
      { name: "Zwiebel", amountG: 100, kcalPer100g: 28, proteinPer100g: 1, costEur: 0.15 }
    ],
    instructions: "Reis kochen. Zwiebel anbraten, Hack krümelig braten. Dosentomaten + TK-Brokkoli dazu, 8 min köcheln. Auf 3 Boxen.",
    perServing: { kcal: 700, protein: 45, carbs: 65, fat: 18, costEur: 3.95 }
  },
  
  egg_rice_tkgemuse: {
    name: "Eier-Reis mit TK-Gemüse (Budget)",
    prepTimeMin: 15,
    servings: 1,  // Frisch zubereitet (Sonntag oder Flex)
    ingredients: [
      { name: "Eier", amount: 4, kcalPerUnit: 78, proteinPerUnit: 6, costEur: 1.00 },
      { name: "Langkorn Reis (trocken)", amountG: 200, kcalPer100g: 360, proteinPer100g: 7, costEur: 0.38 },
      { name: "TK Gemüse", amountG: 250, kcalPer100g: 25, proteinPer100g: 2, costEur: 0.60 },
      { name: "Sojasauce", amountMl: 15, kcalPerMl: 0.5, costEur: 0.08 }
    ],
    instructions: "Reis kochen. TK-Gemüse in Pfanne, Eier dazu, Rührei machen. Sojasauce.",
    perServing: { kcal: 600, protein: 30, carbs: 70, fat: 15, costEur: 2.06 }
  }
};
```

### B3.2: Wochenplan-Zuordnung

```typescript
export const WEEKLY_RECIPE_PLAN = {
  Monday:    "chicken_rice_tkgemuse",   // Kochtag 1 (Prep für Mo-Mi)
  Tuesday:   "chicken_rice_tkgemuse",   // Aufwärmen
  Wednesday: "chicken_rice_tkgemuse",   // Aufwärmen (letzte Portion)
  Thursday:  "hack_rice_tkgemuse",      // Kochtag 2 (Prep für Do-Sa)
  Friday:    "hack_rice_tkgemuse",      // Aufwärmen
  Saturday:  "hack_rice_tkgemuse",      // Aufwärmen
  Sunday:    "egg_rice_tkgemuse"        // Frisch/Flex
};
```

---

## Phase B4: Einkaufsliste (1.5h)

### B4.1: Einkaufslisten-Generator

Erstelle `lib/nutrition/shopping-list.ts`:

```typescript
export interface ShoppingItem {
  name: string;
  amount: string;       // "750g", "3 Stück", "1 Beutel"
  category: string;     // "Protein", "Carbs", "TK-Gemüse", "Milchprodukte", "Getränke"
  estimatedCostEur: number;
  store: "rewe" | "online";
}

export interface ShoppingTrip {
  tripNumber: 1 | 2;
  label: string;        // "Sonntag (Mo-Mi)" | "Mittwoch (Do-Sa)"
  items: ShoppingItem[];
  totalEstimatedCost: number;
}

export function generateShoppingList(mealPlan: MealPlan): ShoppingTrip[]
```

Aggregiert aus den Rezepten + Slots für die jeweiligen 3 Tage. Dedupliziert (z.B. Reis nur 1x pro Einkauf).

### B4.2: Einkauf 1 (Sonntag → Mo, Di, Mi)

```
PROTEIN
  ja! Hähnchenbrust 600g              ~€5.49
  Eier 10er Pack (ja!)                ~€2.49
CARBS
  ja! Langkorn Reis 1kg               ~€1.89
  Haferflocken 500g (ja!)             ~€0.79
TK-GEMÜSE
  REWE BW Asia-Gemüse 750g            ~€1.79
SNACKS
  Snack-Karotten 500g                 ~€1.09
  Hummus klein 150g ×3                ~€4.47
  Arla Skyr 200g ×3                   ~€3.57
GETRÄNKE
  Rote Bete Saft 500ml                ~€1.49
  Ingwer                              ~€0.69
─────────────────────────
TOTAL Einkauf 1:                      ~€23.76
```

### B4.3: Einkauf 2 (Mittwoch → Do, Fr, Sa)

```
PROTEIN
  Rinderhack 500g                     ~€4.29
TK-GEMÜSE
  REWE BW Brokkoli 750g               ~€1.69
SNACKS
  Snack-Karotten 500g                 ~€1.09
  Hummus klein 150g ×2                ~€2.98
  Arla Skyr 200g ×3                   ~€3.57
  Koro Erbsen Flips ×1                ~€3.00
GETRÄNKE
  Rote Bete Saft 500ml                ~€1.49
─────────────────────────
TOTAL Einkauf 2:                      ~€18.11
```

### B4.4: Vorrats-Items (alle 2-4 Wochen, online oder Rewe)

```
HEJ Protein Bars 12er Box             ~€22.44  (online, hej-natural.de)
Whey Isolate 1kg                       ~€25.00  (online)
Creatine 500g                          ~€15.00  (online)
Kollagen-Peptide                       ~€20.00  (online)
Vitamin C                              ~€8.00   (online)
Honig 250g                             ~€3.49   (Rewe)
Sojasauce 250ml                        ~€1.79   (Rewe)
Rapsöl 500ml                           ~€2.29   (Rewe)
Dose Tomaten ×4                        ~€2.36   (Rewe)
Zwiebeln 1kg Netz                      ~€1.29   (Rewe)
```

---

## Phase B5: Nächster-Tag-Anpassung (2h)

### B5.1: Logik

Erstelle `lib/nutrition/daily-adjustment.ts`:

Jeden Morgen (im Cron-Job, nach Garmin-Sync):

```typescript
export async function calculateDailyAdjustment(userId: string, today: Date): Promise<DailyAdjustment | null> {
  // 1. Hole gestriges Garmin-TDEE aus DailySensorData
  const yesterdayTDEE = await getYesterdayTDEE(userId, today);
  if (!yesterdayTDEE) return null;  // Keine Daten → kein Adjustment
  
  // 2. Hole gestrigen Meal Plan (geplante Kalorien)
  const yesterdayPlan = await getYesterdayPlan(userId, today);
  if (!yesterdayPlan) return null;
  
  // 3. Berechne Delta
  const plannedIntake = yesterdayPlan.calorieTarget;
  const actualTDEE = yesterdayTDEE;
  const targetIntake = actualTDEE - 500;  // Defizit
  const delta = plannedIntake - targetIntake;
  
  // 4. Bestimme Anpassung
  if (Math.abs(delta) < 100) {
    return null;  // Innerhalb Toleranz, keine Anpassung
  }
  
  const adjustments: SlotAdjustment[] = [];
  let remaining = delta;
  
  // Hebel 1: Skyr entfernen (−130 kcal)
  if (remaining > 100) {
    adjustments.push({ slot: "postMealDessert", action: "remove", kcalEffect: -130 });
    remaining -= 130;
  }
  
  // Hebel 2: Hummus → nur Karotten (−375 kcal)
  if (remaining > 200) {
    adjustments.push({ slot: "afternoonSnack", action: "reduce", kcalEffect: -375 });
    remaining -= 375;
  }
  
  // Hebel 3: Dinner kleiner (−150 kcal)
  if (remaining > 100) {
    adjustments.push({ slot: "dinner", action: "reduce", kcalEffect: -150 });
    remaining -= 150;
  }
  
  return { date: today, delta, adjustments };
}
```

### B5.2: Adjustment-Nachricht für UI

```typescript
interface DailyAdjustmentMessage {
  date: string;
  yesterdayTDEE: number;
  yesterdayPlannedIntake: number;
  delta: number;
  message: string;  // "Gestern TDEE 2150 kcal, Plan war 2500. Heute: Skyr weglassen."
  adjustments: SlotAdjustment[];
}
```

### B5.3: Cron-Job erweitern

Im bestehenden Cron-Job (21:00 Berlin) oder als separater morgens-Job:

1. Garmin-Sync (bestehend)
2. Daily Adjustment berechnen
3. In `DailyNutritionLog` speichern
4. (Optional) Push-Notification an PWA

---

## Phase B6: Kalibrierung (1h)

### B6.1: Kalibrierungs-Logik

Erstelle `lib/nutrition/calibration.ts`:

```typescript
export async function calibrateMealPlan(userId: string): Promise<CalibrationResult> {
  // 1. Hole letzte 14 Tage TDEE aus DailySensorData
  const tdeeData = await getLast14DaysTDEE(userId);
  
  // 2. Gruppiere nach Tagestyp
  const byDayType = groupByDayType(tdeeData);
  // { strength_run: [3050, 2980, 3100, ...], rest: [2200, 2150, ...], ... }
  
  // 3. Berechne Durchschnitt pro Typ
  const averages = Object.fromEntries(
    Object.entries(byDayType).map(([type, values]) => [
      type,
      Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    ])
  );
  
  // 4. Update DayPlan-Targets
  for (const [dayType, avgTDEE] of Object.entries(averages)) {
    await prisma.dayPlan.updateMany({
      where: { mealPlanId: activePlanId, dayType },
      data: {
        tdeeEstimate: avgTDEE,
        calorieTarget: avgTDEE - 500,
        // Makro-Split: 2g/kg Protein fix, Rest aufteilen
        proteinG: 190,
        carbsG: Math.round((avgTDEE - 500 - 190 * 4 - 70 * 9) / 4),
        fatG: 70
      }
    });
  }
  
  // 5. MealPlan als kalibriert markieren
  await prisma.mealPlan.update({
    where: { id: activePlanId },
    data: { calibrationStatus: "calibrated", calibratedAt: new Date() }
  });
  
  return { averages, status: "calibrated" };
}
```

### B6.2: Re-Kalibrierung

Automatisch alle 2 Wochen oder bei Gewichtsänderung >1kg. Trigger im Cron-Job prüfen.

---

## Phase B7: UI — Meal Plan Ansicht (2h)

### B7.1: Neue Seite `/nutrition`

Erstelle `app/nutrition/page.tsx`:

Zeigt den aktuellen Tagesplan an:
- Heutiger Tagestyp + Kalorien-Target
- Alle Slots mit Items, Kalorien, Protein
- Wenn ein Adjustment aktiv ist: farblich markiert (Skyr durchgestrichen, etc.)
- Summe unten: Kcal / Protein / Cost

### B7.2: Einkaufsliste-View

Button "Einkaufsliste" → zeigt die nächste Einkaufsliste (Trip 1 oder 2, je nach Wochentag):
- Gruppiert nach Kategorie
- Checkbox pro Item (lokal, kein DB-Tracking nötig)
- Geschätzte Kosten pro Item + Total

### B7.3: Wochenübersicht

7-Tage-Übersicht: welcher Tagestyp, welches Rezept, Kochtag markiert.

### B7.4: Navigation

FloatingNav erweitern: neuer Tab "Nutrition" (Utensils-Icon oder ähnlich).

### B7.5: Design

Direction C (Geist + GeistMono), konsistent mit bestehendem App-Design. Session-Type-Farben für die Tagestypen wiederverwenden.

---

## Phase B8: Coaching-Export erweitern (30min)

Neue Sektion im Coaching-Export für Nutrition:

```typescript
nutrition: {
  activePlan: {
    name: string,
    calibrationStatus: string,
    calibratedAt: string | null
  },
  todayPlan: {
    dayType: string,
    calorieTarget: number,
    slots: MealSlots,
    adjustment: DailyAdjustment | null
  },
  last7DaysLog: [
    {
      date: string,
      dayType: string,
      calorieTarget: number,
      garminTDEE: number | null,
      delta: number | null,
      adjustment: string | null,
      followed: boolean,
      notes: string | null
    }
  ],
  weeklyBudget: {
    planned: number,
    perDay: number
  }
}
```

---

## Phase B9: Coaching-Update Actions erweitern (30min)

Neue Actions für den Write-Endpoint:

```typescript
| { action: "updateMealPlan"; data: { dayType: string; slot: string; items: MealItem[] }; reason: string }
| { action: "updateCalorieTargets"; data: { dayType: string; calorieTarget: number; proteinG: number; carbsG: number; fatG: number }; reason: string }
| { action: "triggerCalibration"; data: {}; reason: string }
| { action: "adjustDaySlot"; data: { date: string; slot: string; action: "remove" | "reduce" | "add"; item?: MealItem }; reason: string }
```

---

## Phase B10: Seed-Data + Tests (1.5h)

### B10.1: Initial Meal Plan erstellen

Seed-Script das den ersten MealPlan mit allen 4 DayPlans (strength_run, threshold, long_run, rest) erstellt, befüllt mit den initialen Targets und Slot-Strukturen.

### B10.2: Tests

- DayType-Mapping korrekt für alle 7 Wochentage
- Einkaufslisten-Generator: Output hat korrekte Items + Kosten
- Daily-Adjustment: Delta >100 → Skyr entfernt, Delta >300 → Hummus reduziert
- Daily-Adjustment: Delta <100 → kein Adjustment
- Kalibrierung: Aktualisiert DayPlan-Targets korrekt
- Coaching-Update Actions: updateMealPlan schreibt korrekt in DB
- Coaching-Export: nutrition-Sektion ist befüllt
- Rest-Tag: kein Pre-Training-Slot, kein Skyr

---

## Verification + Deploy

### Definition of Done

**Teil A:**
- [ ] `POST /api/coaching-update?token=<correct>` → 200, DB-Änderung, CoachingLog-Eintrag
- [ ] `POST /api/coaching-update` → 401
- [ ] Garmin-Wellness-Daten (HRV, Sleep, Body Battery, Kalorien) werden im Cron-Job gesynct
- [ ] Coaching-Export zeigt befüllte Wellness-Felder (nicht mehr `null` nach nächstem Sync)
- [ ] Coaching-Export enthält `calories.averageByDayType`
- [ ] Health-Daten korrigiert: therapyPhase=REMODELING, activeInjuries=shin_splints

**Teil B:**
- [ ] MealPlan + DayPlans in DB erstellt mit initialen Targets
- [ ] `/nutrition` zeigt heutigen Tagesplan mit allen Slots
- [ ] Einkaufsliste generiert korrekt für Trip 1 (Mo-Mi) und Trip 2 (Do-Sa)
- [ ] Daily-Adjustment berechnet korrekt basierend auf Garmin-TDEE Delta
- [ ] Kalibrierung aktualisiert Targets nach 14 Tagen Datensammlung
- [ ] Coaching-Export enthält nutrition-Sektion
- [ ] Coaching-Update: `updateMealPlan` + `updateCalorieTargets` funktionieren
- [ ] Rest-Tage haben korrekten reduzierten Plan (kein Pre-Training, kein Skyr)
- [ ] FloatingNav enthält Nutrition-Tab
- [ ] Tests grün
- [ ] `npx tsc --noEmit` → clean
- [ ] `npm run build` → erfolgreich

### Commit + Deploy

```bash
git add -A
git commit -m "Sprint v0.16: Nutrition Module + Coaching Infrastructure

Part A — Coaching Infrastructure:
- POST /api/coaching-update with action router + reason logging
- CoachingLog table for audit trail
- Garmin wellness sync: HRV, sleep, body battery, TDEE calories
- Health data corrections (therapy phase, injuries)

Part B — Nutrition Module:
- MealPlan + DayPlan data model with 4 day types
- 3 meal prep recipes (chicken/hack/egg + rice + TK vegetables)
- Shopping list generator (2 trips per week)
- Next-day adjustment based on Garmin TDEE delta
- Flexible slot system (Skyr as adjustment lever)
- Calibration engine (14-day TDEE averages per day type)
- /nutrition page with daily plan + shopping list + weekly overview
- Coaching export + update integration

Budget: €15/day target, actual estimate ~€10/day."
git push
```

---

## Wichtige Hinweise

**1. Kalibrierungs-Reihenfolge.** Der Meal Plan wird initial mit geschätzten Werten erstellt (Phase B2.2). Die echten Werte kommen erst nach 2 Wochen Garmin-TDEE-Sammlung. Bis dahin funktioniert alles, nur die Kalorien-Targets sind Schätzungen.

**2. Garmin-Sync muss zuerst funktionieren.** Phase A2 (Garmin-Wellness-Fix) muss VOR Phase B5 (Daily-Adjustment) abgeschlossen sein, weil B5 von den TDEE-Kalorien abhängt.

**3. Preise sind Schätzungen.** Alle `costEur`-Werte in den Rezepten und Einkaufslisten sind konservative Schätzungen für Rewe Berlin. Q wird die echten Preise beim ersten Einkauf verifizieren.

**4. Keine neuen Felder erfinden.** Wenn ein Garmin-Feld (`hrvRMSSD`, `sleepScore`, etc.) über `@flow-js/garmin-connect` nicht abrufbar ist → `null` lassen, nicht dummy-Daten eintragen. Dokumentiere welche Felder tatsächlich verfügbar waren.

**5. Q's Essens-Constraints.**
- Kein Ofen, nur Herd (Pfanne/Topf)
- Max 1x kochen pro Tag
- Meal Prep für 2-3 Tage
- Einzelportionen bei Snacks (Hummus 150g Becher, nicht 400g)
- Saucen unter 20 kcal/Portion werden nicht getrackt
- Tiefkühlgemüse statt frisch (außer Karotten für Snack)

**6. Write-Endpoint Sicherheit.** Gleicher Token wie Export. Jede Änderung wird in CoachingLog geloggt mit `reason`. Der Endpoint darf NUR die definierten Actions ausführen — kein generisches SQL oder Prisma-Passthrough.
