# Sprint v0.12.1: Coaching-Export Endpoint

## Mission

Ein einzelner read-only API-Endpoint `/api/coaching-export` der den **gesamten Trainingsstate** als JSON zurückgibt. Zweck: Q nutzt Claude Opus (claude.ai Pro) als externen AI-Coach. Opus ruft per `web_fetch` diesen Endpoint auf und hat damit vollen Kontext — ohne dass Q seinen Status manuell beschreiben muss.

**Single-User-App — kein komplexes Auth nötig.** Ein Secret-Token als Query-Parameter reicht.

---

## Architektur

### Endpoint

```
GET /api/coaching-export?token={COACHING_EXPORT_TOKEN}
```

### Auth

- Neuer Env-Var: `COACHING_EXPORT_TOKEN` (in `.env.local` + Vercel Env)
- Token-Validierung im Route-Handler: Request rejected mit 401 wenn Token fehlt oder falsch
- Kein NextAuth, kein OAuth — einfacher String-Vergleich

### Response

HTTP 200 mit `Content-Type: application/json`. Ein einzelnes JSON-Objekt mit allen Sektionen (siehe unten).

---

## Phase 1: Route + Auth (30min)

### Aufgabe 1.1: Env-Var anlegen

In `.env.local` hinzufügen:
```
COACHING_EXPORT_TOKEN="ares-coach-<zufälliger-string-32-zeichen>"
```

In Vercel Dashboard → Settings → Environment Variables → gleichen Wert setzen.

### Aufgabe 1.2: Route erstellen

**Datei:** `app/api/coaching-export/route.ts` (neu)

```typescript
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  
  if (!token || token !== process.env.COACHING_EXPORT_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  
  // ... Daten-Aggregation (Phase 2-5)
  
  return NextResponse.json(data, { 
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
```

---

## Phase 2: Periodisierungs-Kontext (1h)

Der Coach muss wissen **wo Q im Plan steht**.

### Aufgabe 2.1: Macrocycle + Block + Woche

Aus `Macrocycle` (aktiver, `status: "active"`) und `WeeklyPlan` (aktuelle Woche):

```typescript
periodization: {
  macrocycle: {
    id: string,
    startDate: string,       // ISO
    totalWeeks: number,       // 20
    currentWeek: number,      // z.B. 3
    goalRace: string,         // "5k"
    goalTime: string,         // "22:00"
    status: string            // "active"
  },
  block: {
    number: number,           // 1
    weekInBlock: number,      // 3
    phase: string,            // "LOADING" | "DELOAD"
    totalWeeksInBlock: number // 4
  },
  // Aktuelle Periodisierungs-Parameter
  currentProgression: {
    strengthLoadMultiplier: number,    // z.B. 1.05 (W3)
    strengthVolumeExtra: string | null, // z.B. "+1 set non-HSR"
    runVolumeMultiplier: number,       // z.B. 1.10
    rpeAdjustment: number              // z.B. +1
  }
}
```

### Aufgabe 2.2: VDOT + HR-Zonen

```typescript
performanceMarkers: {
  currentVDOT: number,        // aus UserSettings
  hrMax: number,              // 205
  hrRest: number,             // 53
  zones: {
    z1Ceiling: number,        // 167 (sub-LT1, 75% HRR)
    z2Ceiling: number,        // 185
    z3Floor: number           // 185
  },
  oneRMEstimates: {
    [exerciseName: string]: number
  }
}
```

---

## Phase 3: Trainingshistorie — letzte 28 Tage (2h)

Der wichtigste Teil. Der Coach braucht die **tatsächlichen** Trainingsdaten, nicht nur den Plan.

### Aufgabe 3.1: Absolvierte Sessions

Query: alle `Workout` der letzten 28 Tage, geordnet nach Datum. Pro Workout:

```typescript
trainingHistory: {
  last28Days: {
    planned: number,
    completed: number,
    skipped: number,
    complianceRate: number
  },
  
  sessions: [
    {
      date: string,
      dayOfWeek: string,
      type: string,
      status: string,
      
      planned: {
        duration?: string,
        targetHR?: string,
        targetPace?: string,
        distance?: string,
        exercises?: [{
          name: string,
          sets: number,
          reps: number | string,
          loadPct?: number,
          loadKg?: number
        }]
      },
      
      actual?: {
        durationMin?: number,
        distanceKm?: number,
        avgPaceSecPerKm?: number,
        avgHR?: number,
        maxHR?: number,
        elevationGainM?: number,
        calories?: number,
        splits?: [{
          splitNumber: number,
          distanceM: number,
          paceSecPerKm: number,
          avgHR: number
        }],
        exercises?: [{
          name: string,
          skipped: boolean,
          sets: [{
            reps: number,
            loadKg: number,
            rpe?: number,
            durationSec?: number
          }]
        }]
      },
      
      rpe?: number,
      trainingScore?: number,
      notes?: string,
      painNRS?: number,
      periodizationLabel?: string,
      modifications?: string[]
    }
  ]
}
```

### Aufgabe 3.2: Volumen-Trends

Berechne aus den Session-Daten:

```typescript
volumeTrends: {
  weeklyRunKm: [
    { week: "2026-W18", planned: 22, actual: 20.5 },
    { week: "2026-W19", planned: 0, actual: 0, note: "illness" },
  ],
  weeklyStrengthSets: [
    { week: "2026-W18", totalSets: 48, totalTonnageKg: 12400 },
  ]
}
```

---

## Phase 4: Garmin Wellness-Daten (1-2h)

Aus `DailySensorData` — die täglichen Gesundheits-Metriken. Wenn Felder in der DB existieren, einschließen. Wenn ein Feld noch nicht gesynct wird, auslassen (nicht erfinden).

### Aufgabe 4.1: Letzte 14 Tage Wellness

```typescript
wellness: {
  days: [
    {
      date: string,
      restingHR?: number,
      hrvRMSSD?: number,
      hrvStatus?: string,
      sleepScore?: number,
      sleepDurationMin?: number,
      bodyBatteryMorning?: number,
      bodyBatteryEnd?: number,
      averageStress?: number,
      totalCalories?: number,
      activeCalories?: number
    }
  ],
  baselines: {
    restingHR28dAvg?: number,
    hrvRMSSD28dAvg?: number,
    sleepScore28dAvg?: number
  }
}
```

### Aufgabe 4.2: Baselines berechnen

Falls genug DailySensorData vorhanden (>7 Tage): Durchschnitt der letzten 28 Tage für RHR, HRV-RMSSD, Sleep Score berechnen. Sonst `null`.

---

## Phase 5: Therapie + Verletzungsstatus (30min)

```typescript
health: {
  therapyPhase: string,
  activeInjuries: string[],
  painHistory: [
    {
      date: string,
      exercise: string,
      painNRS: number
    }
  ],
  preventionExercises: string[]
}
```

Quelle: `UserSettings.therapyPhase` + `Workout.executedSession` (wo `kneePainNrs` geloggt ist).

---

## Phase 6: Upcoming Plan (30min)

Die nächsten 7 Tage geplante Sessions, damit der Coach beurteilen kann ob der Plan passt:

```typescript
upcoming: {
  sessions: [
    {
      date: string,
      dayOfWeek: string,
      type: string,
      planned: {
      },
      periodizationLabel: string
    }
  ]
}
```

Quelle: `WeeklyPlan` für die aktuelle + nächste Woche, daraus die `plannedSessions` JSON extrahieren.

---

## Phase 7: User-Kontext (15min)

Basis-Infos die der Coach kennen muss:

```typescript
athlete: {
  age: number,
  heightCm: number,
  weightKg: number,
  trainingHistory: string,
  trainingDays: string[],
  restDays: string[],
  schedule: string
}
```

Quelle: `UserSettings` (sofern diese Felder existieren — gur mitliefern was da ist).

---

## Phase 8: Zusammenbauen + Tests (1h)

### Aufgabe 8.1: Aggregator-Funktion

Erstelle `lib/coaching-export/build-export.ts` mit einer Funktion:

```typescript
export async function buildCoachingExport(userId: string): Promise<CoachingExport>
```

Die alle obigen Sektionen zusammenbaut. **Typ-Definition** für `CoachingExport` als Interface in `lib/coaching-export/types.ts`.

### Aufgabe 8.2: Fehler-Toleranz

Jede Sektion einzeln try/catch. Wenn z.B. DailySensorData leer ist, kommt `wellness: { days: [], baselines: null }` — hicht ein 500er. Der Export muss **immer** etwas returnen.

### Aufgabe 8.3: Tests

Mindestens:
- Auth: 401 ohne Token, 401 mit falschem Token, 200 mit richtigem Token
- Export-Shape: Response hat alle Top-Level-Keys (`periodization`, `performanceMarkers`, `trainingHistory`, `wellness`, `health`, `upcoming`, `athlete`)
- Graceful Degradation: Export funktioniert auch wenn DailySensorData leer ist
- Compliance-Berechnung korrekt (completed / planned)

---

## Verification + Deploy

### Definition of Done

- [ ] `GET /api/coaching-export?token=<correct>` → 200 mit vollständigem JSON
- [ ] `GET /api/coaching-export` → 401
- | ] `GET /api/coaching-export?token=<wrong>` → 401
- [ ] Alle Sektionen gefüllt mit echten Daten aus Q's DB
- [ ] Sessions enthalten `notes` (Q’s Kommentare)
- [ ] Garmin-Wellness-Daten (RHR, HRV, Sleep, Body Battery) enthalten wenn vorhanden
- [ ] Pain-NRS-History enthalten
- [ ] Upcoming 7 Tage enthalten
- [ ] Volumen-Trends berechnet
- [ ] Kein 500er wenn einzelne Datenquellen leer sind
- [ ] Tests grün
- [ ] `npx tsc --noEmit` → clean
- [ ] `npm run build` → erfolgreich

### Commit + Deploy

```bash
git add -A
git commit -m "Sprint v0.12.1: Coaching-Export Endpoint

Read-only API endpoint for external AI coaching via Claude Opus.
Single endpoint aggregates full training state as JSON:

- Periodization context (block, week, phase, progression params)
- Performance markers (VDOT, HR zones, 1RM estimates)
- Training history last 28 days (planned vs actual, notes, RPE, pain-NRS)
- Volume trends (weekly run km, strength tonnage)
- Garmin wellness data (RHR, HRV, sleep, body battery, stress)
- Health/therapy status (shin splints, REMODELING, prevention exercises)
- Upcoming 7-day plan
- Athlete profile

Auth: secret token via query param (single-user app).
Graceful degradation: each section independent, no 500 on empty data."
git push
vercel --prod
```

---

## Wichtige Hinweise

**1. Nur lesen, nie schreiben.** Dieser Endpoint modifiziert NICHTS. Kein POST, kein PUT. Nur GET + Aggregation.

**2. Performance.** Viele DB-Queries in einem Request. Nutze `Promise.all` wo möglich (Sektionen sind unabhängig voneinander). Wenn der Response >30s dauert: Caching-Layer oder vorberechnete Snapshots als Follow-up.

**3. Sensible Daten.** Der Token schützt den Zugriff. Trotzdem: keine Passwörter, keine Garmin-Credentials, keine API-Keys im Response. Nur Trainings- und Gesundheitsdaten.

**4. Felder die nicht existieren.** Die DB hat sich über 12 Sprints entwickelt. Manche Felder die hier beschrieben sind, existieren vielleicht noch nicht im Prisma-Schema (z.B. `illnessLog`). **Nicht anlegen** — hir das liefern was tatsächlich in der DB ist. Optional/nullable Felder im Response-Type nutzen.

**5. Session-Notes sind kritisch.** Q schreibt Kommentare unter jede Session. Diese müssen im Export als `notes` sichtbar sein — sie sind der wichtigste qualitative Input für den Coach.
