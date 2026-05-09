"use client";

// Nutrition dashboard — Sprint v0.16 Phase B7.
// Three tabs: Today (full slot breakdown), Shopping (next trip), Week (7-day overview).
// Direction-C theme (Geist + GeistMono), session-color accents.

import { useEffect, useState } from "react";
import { CalendarDays, ChefHat, ShoppingCart, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DayType, MealSlots, DailyAdjustment } from "@/lib/nutrition/types";
import type { ShoppingTrip } from "@/lib/nutrition/shopping-list";

interface NutritionTodayResponse {
  date: string;
  dayOfWeek: string;
  dayType: DayType;
  source: "active_plan" | "template_fallback";
  plan: {
    name: string;
    calibrationStatus: string;
    calibratedAt: string | null;
    budgetPerDay: number;
  } | null;
  dayPlan: {
    dayType: DayType;
    tdeeEstimate: number;
    calorieTarget: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    slots: MealSlots;
  };
  totals: { kcal: number; protein: number; carbs: number; fat: number; costEur: number };
  adjustment: DailyAdjustment | null;
  shopping: { next: ShoppingTrip };
  weekOverview: {
    date: string;
    dayOfWeek: string;
    dayType: DayType;
    recipeKey: string;
    recipeName: string;
    isCookDay: boolean;
  }[];
  slotLabels: Record<string, string>;
}

type Tab = "today" | "shopping" | "week";

const DAY_TYPE_LABEL: Record<DayType, string> = {
  strength_run: "Kraft + Lauf",
  threshold: "Schwelle",
  long_run: "Long Run",
  rest: "Pause",
};

// Session-color mapping reused from training UI for visual consistency.
const DAY_TYPE_ACCENT: Record<DayType, string> = {
  strength_run: "#8B5CF6", // violet — strength sessions
  threshold: "#F59E0B", // amber — threshold runs
  long_run: "#10B981", // emerald — long runs
  rest: "#6B7280", // gray — rest
};

export default function NutritionDashboard() {
  const [data, setData] = useState<NutritionTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    let active = true;
    fetch("/api/nutrition/today")
      .then((r) => r.json())
      .then((d: NutritionTodayResponse) => {
        if (!active) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-8 pb-32 text-sm text-[var(--color-foreground-tertiary)]">
        Lade Nutrition-Plan…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-8 pb-32 text-sm text-red-400">
        Fehler: {error ?? "unbekannt"}
      </div>
    );
  }

  const accent = DAY_TYPE_ACCENT[data.dayType];

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-32">
      {/* Header */}
      <header className="mb-6">
        <div className="font-mono text-xs uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          {data.dayOfWeek} · {data.date}
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <span
            className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium"
            style={{ backgroundColor: `${accent}1A`, color: accent }}
          >
            {DAY_TYPE_LABEL[data.dayType]}
          </span>
          <span>Nutrition</span>
        </h1>
        {data.source === "template_fallback" && (
          <div className="mt-2 rounded-md border border-yellow-900/50 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-200">
            Kein aktiver MealPlan in der DB — Fallback auf Standard-Template.
            <code className="ml-1 font-mono">npx tsx scripts/v0_16_seed_meal_plan.ts</code>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border p-1" style={{ borderColor: "var(--color-border)" }}>
        <TabButton current={tab} value="today" onClick={setTab} icon={Utensils}>
          Heute
        </TabButton>
        <TabButton current={tab} value="shopping" onClick={setTab} icon={ShoppingCart}>
          Einkauf
        </TabButton>
        <TabButton current={tab} value="week" onClick={setTab} icon={CalendarDays}>
          Woche
        </TabButton>
      </div>

      {tab === "today" && <TodayView data={data} accent={accent} />}
      {tab === "shopping" && <ShoppingView trip={data.shopping.next} />}
      {tab === "week" && <WeekView weekOverview={data.weekOverview} todayDate={data.date} />}
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────

interface TabButtonProps {
  current: Tab;
  value: Tab;
  onClick: (t: Tab) => void;
  icon: React.ElementType;
  children: React.ReactNode;
}

function TabButton({ current, value, onClick, icon: Icon, children }: TabButtonProps) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
          : "text-[var(--color-foreground-secondary)] hover:bg-white/5",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

// ── Today view ───────────────────────────────────────────────────────────

interface TodayViewProps {
  data: NutritionTodayResponse;
  accent: string;
}

function TodayView({ data, accent }: TodayViewProps) {
  const { dayPlan, totals, adjustment, slotLabels } = data;
  const slotEntries = Object.entries(dayPlan.slots) as [keyof MealSlots, MealSlots[keyof MealSlots]][];

  return (
    <div className="space-y-6">
      {/* Targets */}
      <section className="rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          Targets
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Kalorien-Ziel" value={`${dayPlan.calorieTarget}`} unit="kcal" accent={accent} />
          <Stat label="Protein" value={`${dayPlan.proteinG}`} unit="g" />
          <Stat label="Kohlenhydrate" value={`${dayPlan.carbsG}`} unit="g" />
          <Stat label="Fett" value={`${dayPlan.fatG}`} unit="g" />
        </div>
        <div className="mt-3 font-mono text-xs text-[var(--color-foreground-tertiary)]">
          TDEE-Estimate: {dayPlan.tdeeEstimate} kcal · Defizit: {dayPlan.tdeeEstimate - dayPlan.calorieTarget} kcal
        </div>
      </section>

      {/* Adjustment alert */}
      {adjustment && (
        <section className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-amber-200">
            <ChefHat className="h-3.5 w-3.5" /> Heutiges Adjustment
          </h2>
          <p className="text-sm text-amber-100">{adjustment.message}</p>
          <div className="mt-3 space-y-1">
            {adjustment.adjustments.map((a, i) => (
              <div key={i} className="flex items-center justify-between font-mono text-xs">
                <span className="text-amber-200">
                  {slotLabels[a.slot] ?? a.slot} → {a.action}
                </span>
                <span className="text-amber-300">{a.kcalEffect > 0 ? "+" : ""}{a.kcalEffect} kcal</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Slots */}
      <section className="space-y-3">
        {slotEntries.map(([key, slot]) => {
          if (slot.items.length === 0) return null;
          const isAdjusted = adjustment?.adjustments.some((a) => a.slot === key);
          return (
            <SlotCard
              key={key}
              label={slotLabels[key] ?? key}
              slot={slot}
              adjusted={isAdjusted}
              flexible={slot.flexible}
            />
          );
        })}
      </section>

      {/* Totals */}
      <section
        className="rounded-lg border p-4"
        style={{ borderColor: "var(--color-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
      >
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          Tages-Summe (geplant)
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="kcal" value={`${totals.kcal}`} unit="kcal" accent={accent} />
          <Stat label="Protein" value={`${totals.protein}`} unit="g" />
          <Stat label="Carbs" value={`${totals.carbs}`} unit="g" />
          <Stat label="Fat" value={`${totals.fat}`} unit="g" />
          <Stat label="Kosten" value={`${totals.costEur.toFixed(2)}`} unit="€" />
        </div>
        <div className="mt-3 font-mono text-xs text-[var(--color-foreground-tertiary)]">
          Diff zu Ziel: {totals.kcal - dayPlan.calorieTarget > 0 ? "+" : ""}
          {totals.kcal - dayPlan.calorieTarget} kcal
        </div>
      </section>
    </div>
  );
}

interface SlotCardProps {
  label: string;
  slot: MealSlots[keyof MealSlots];
  adjusted?: boolean;
  flexible?: boolean;
}

function SlotCard({ label, slot, adjusted, flexible }: SlotCardProps) {
  const total = slot.items.reduce(
    (acc, i) => ({ kcal: acc.kcal + i.kcal, protein: acc.protein + i.protein, costEur: acc.costEur + i.costEur }),
    { kcal: 0, protein: 0, costEur: 0 },
  );

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-opacity",
        adjusted && "opacity-50 line-through decoration-amber-400/60",
      )}
      style={{ borderColor: "var(--color-border)" }}
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-xs font-medium uppercase tracking-wider text-[var(--color-foreground-secondary)]">
          {label}
          {flexible && (
            <span className="ml-2 rounded bg-cyan-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
              flex
            </span>
          )}
        </h3>
        <div className="font-mono text-xs text-[var(--color-foreground-tertiary)]">
          {Math.round(total.kcal)} kcal · {Math.round(total.protein)}g P · {total.costEur.toFixed(2)}€
        </div>
      </header>
      <ul className="space-y-1">
        {slot.items.map((item, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
            <span>{item.name}</span>
            <span className="font-mono text-xs text-[var(--color-foreground-tertiary)]">
              {item.kcal} · {item.protein}P · {item.costEur.toFixed(2)}€
            </span>
          </li>
        ))}
      </ul>
      {slot.recipe && (
        <div className="mt-2 font-mono text-[11px] text-[var(--color-foreground-tertiary)]">Rezept: {slot.recipe}</div>
      )}
      {slot.alternatives && slot.alternatives.length > 0 && (
        <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
            Alternative
          </div>
          <ul className="mt-1 space-y-1">
            {slot.alternatives.map((alt, i) => (
              <li key={i} className="flex items-baseline justify-between text-sm text-[var(--color-foreground-secondary)]">
                <span>
                  {alt.name}
                  {alt.maxPerWeek && (
                    <span className="ml-2 font-mono text-[11px] text-[var(--color-foreground-tertiary)]">
                      max {alt.maxPerWeek}×/Woche
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs text-[var(--color-foreground-tertiary)]">
                  {alt.kcal} · {alt.protein}P · {alt.costEur.toFixed(2)}€
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Stat helper ──────────────────────────────────────────────────────────

function Stat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-xl font-medium tabular-nums" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        {unit && <span className="font-mono text-xs text-[var(--color-foreground-tertiary)]">{unit}</span>}
      </div>
    </div>
  );
}

// ── Shopping view ────────────────────────────────────────────────────────

function ShoppingView({ trip }: { trip: ShoppingTrip }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Group by category
  const byCategory: Record<string, typeof trip.items> = {};
  for (const item of trip.items) {
    (byCategory[item.category] ??= []).push(item);
  }

  return (
    <div className="space-y-4">
      <header
        className="rounded-lg border p-4"
        style={{ borderColor: "var(--color-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
      >
        <div className="font-mono text-xs uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          Trip {trip.tripNumber} — {trip.label}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{trip.totalEstimatedCost.toFixed(2)} €</div>
        <div className="mt-1 font-mono text-xs text-[var(--color-foreground-tertiary)]">
          Deckt {trip.coversDays.join(" / ")} ab
        </div>
      </header>

      {Object.entries(byCategory).map(([cat, items]) => (
        <section
          key={cat}
          className="rounded-lg border p-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h3 className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-[var(--color-foreground-secondary)]">
            {cat}
          </h3>
          <ul className="space-y-1">
            {items.map((item, i) => {
              const id = `${cat}-${i}-${item.name}`;
              const isChecked = checked[id] ?? false;
              return (
                <li key={id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => setChecked((c) => ({ ...c, [id]: !c[id] }))}
                    className="h-4 w-4 rounded border-[var(--color-border)] bg-transparent"
                  />
                  <div className={cn("flex flex-1 items-baseline justify-between text-sm", isChecked && "opacity-40 line-through")}>
                    <span>
                      {item.name}{" "}
                      <span className="font-mono text-xs text-[var(--color-foreground-tertiary)]">
                        ({item.amount})
                      </span>
                    </span>
                    <span className="font-mono text-xs text-[var(--color-foreground-tertiary)]">
                      {item.estimatedCostEur.toFixed(2)} € · {item.store}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── Week view ────────────────────────────────────────────────────────────

interface WeekViewProps {
  weekOverview: NutritionTodayResponse["weekOverview"];
  todayDate: string;
}

function WeekView({ weekOverview, todayDate }: WeekViewProps) {
  return (
    <div className="space-y-2">
      {weekOverview.map((d) => {
        const isToday = d.date === todayDate;
        const accent = DAY_TYPE_ACCENT[d.dayType];
        return (
          <div
            key={d.date}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              isToday && "ring-1 ring-[var(--color-foreground)]",
            )}
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: isToday ? "rgba(255,255,255,0.04)" : undefined,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium"
                  style={{ backgroundColor: `${accent}1A`, color: accent }}
                >
                  {DAY_TYPE_LABEL[d.dayType]}
                </div>
                <div>
                  <div className="text-sm font-medium">{d.dayOfWeek}</div>
                  <div className="font-mono text-[11px] text-[var(--color-foreground-tertiary)]">{d.date}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm">{d.recipeName}</div>
                {d.isCookDay && (
                  <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-orange-900/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-orange-300">
                    <ChefHat className="h-3 w-3" /> Kochtag
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
