"use client";

// Nutrition dashboard — Sprint v0.16 Phase B7.
// Three tabs: Today (full slot breakdown), Shopping (next trip), Week (7-day overview).
// Direction-C theme (Geist + GeistMono), session-color accents.

import { useEffect, useState } from "react";
import { CalendarDays, ChefHat, ChevronDown, ShoppingCart, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSessionColor } from "@/lib/ui/session-colors";
import type { DayType, MealSlots, DailyAdjustment } from "@/lib/nutrition/types";
import type { ShoppingTrip } from "@/lib/nutrition/shopping-list";

type SessionColors = ReturnType<typeof getSessionColor>;

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
    mainMealRecipeName?: string;
    dinnerRecipeName?: string;
    isCookDay: boolean;
  }[];
  weekdaySlots: Record<number, MealSlots>;
  slotLabels: Record<string, string>;
}

type Tab = "today" | "shopping" | "week";

const DAY_TYPE_LABEL: Record<DayType, string> = {
  strength_run: "Kraft + Lauf",
  threshold: "Schwelle",
  long_run: "Long Run",
  rest: "Pause",
};

// Each nutrition day-type maps to a canonical training session-type so the
// design system's session-color vocabulary (lib/ui/session-colors.ts) is the
// single source of truth. strength_run aggregates strength_a/b/c — they all
// resolve to Slate Strength.
const DAY_TYPE_TO_SESSION: Record<DayType, string> = {
  strength_run: "strength_a",
  threshold: "threshold_run",
  long_run: "long_run",
  rest: "rest",
};

function colorsForDayType(dayType: DayType): SessionColors {
  return getSessionColor(DAY_TYPE_TO_SESSION[dayType]);
}

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
      <div className="mx-auto max-w-3xl px-4 pt-8 pb-32 text-sm text-[var(--color-destructive)]">
        Fehler: {error ?? "unbekannt"}
      </div>
    );
  }

  const accent = colorsForDayType(data.dayType);

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
            style={{ backgroundColor: accent.bg, color: accent.color }}
          >
            {DAY_TYPE_LABEL[data.dayType]}
          </span>
          <span>Nutrition</span>
        </h1>
        {data.source === "template_fallback" && (
          <div className="mt-2 rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            Kein aktiver MealPlan in der DB — Fallback auf Standard-Template.
            <code className="ml-1 font-mono">npx tsx scripts/v0_16_seed_meal_plan.ts</code>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border border-[var(--color-border)] p-1">
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
      {tab === "week" && (
        <WeekView
          weekOverview={data.weekOverview}
          todayDate={data.date}
          weekdaySlots={data.weekdaySlots}
          slotLabels={data.slotLabels}
        />
      )}
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
  accent: SessionColors;
}

function TodayView({ data, accent }: TodayViewProps) {
  const { dayPlan, totals, adjustment, slotLabels } = data;
  const slotEntries = Object.entries(dayPlan.slots) as [keyof MealSlots, MealSlots[keyof MealSlots]][];

  return (
    <div className="space-y-6">
      {/* Targets */}
      <section className="rounded-lg border border-[var(--color-border)] p-4">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          Targets
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Kalorien-Ziel" value={`${dayPlan.calorieTarget}`} unit="kcal" accent={accent.color} />
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

      {/* Day Summary — target comparison with color coding */}
      <section className="rounded-lg border border-[var(--color-border)] bg-white/[0.02] p-4">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          Tages-Summe (geplant)
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="kcal" value={`${totals.kcal}`} unit="kcal" accent={accent.color} />
          <Stat label="Protein" value={`${totals.protein}`} unit="g" />
          <Stat label="Carbs" value={`${totals.carbs}`} unit="g" />
          <Stat label="Fat" value={`${totals.fat}`} unit="g" />
          <Stat label="Kosten" value={`${totals.costEur.toFixed(2)}`} unit="€" />
        </div>
        <div className="mt-3 space-y-1">
          <SummaryRow label="Kalorien" value={totals.kcal} target={dayPlan.calorieTarget} unit="kcal" tolerance={30} />
          <SummaryRow label="Protein" value={totals.protein} target={dayPlan.proteinG} unit="g" tolerance={10} />
          <SummaryRow label="Kosten" value={totals.costEur} target={15} unit="€" tolerance={1} />
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
        "rounded-lg border border-[var(--color-border)] p-4 transition-opacity",
        adjusted && "opacity-50 line-through decoration-amber-400/60",
      )}
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-xs font-medium uppercase tracking-wider text-[var(--color-foreground-secondary)]">
          {label}
          {flexible && (
            <span className="ml-2 rounded-[3px] bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-foreground-secondary)]">
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
      {(slot.recipeName ?? slot.recipe) && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-[4px] bg-[rgba(255,255,255,0.06)] px-2 py-1">
          <Utensils className="h-3 w-3 text-[var(--color-foreground-tertiary)]" />
          <span className="font-mono text-[11px] font-medium text-[var(--color-foreground-secondary)]">
            {slot.recipeName ?? slot.recipe}
          </span>
        </div>
      )}
      {slot.alternatives && slot.alternatives.length > 0 && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
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
        <span className="num-md" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        {unit && <span className="font-mono text-xs text-[var(--color-foreground-tertiary)]">{unit}</span>}
      </div>
    </div>
  );
}

// ── Summary row — target comparison with color coding ───────────────────

function SummaryRow({
  label,
  value,
  target,
  unit,
  tolerance,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  tolerance: number;
}) {
  const diff = value - target;
  const withinTolerance = Math.abs(diff) <= tolerance;
  const colorClass = withinTolerance
    ? "text-emerald-400"
    : "text-red-400";

  return (
    <div className="flex items-center justify-between font-mono text-xs">
      <span className="text-[var(--color-foreground-tertiary)]">{label}</span>
      <span className={colorClass}>
        {unit === "€" ? value.toFixed(2) : Math.round(value)} / {unit === "€" ? target.toFixed(2) : target} {unit}
        {" "}
        ({diff > 0 ? "+" : ""}{unit === "€" ? diff.toFixed(2) : Math.round(diff)})
      </span>
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
      <header className="rounded-lg border border-[var(--color-border)] bg-white/[0.02] p-4">
        <div className="font-mono text-xs uppercase tracking-wider text-[var(--color-foreground-tertiary)]">
          Trip {trip.tripNumber} — {trip.label}
        </div>
        <div className="mt-2 num-lg">
          {trip.totalEstimatedCost.toFixed(2)}
          <span className="ml-1 font-mono text-xs text-[var(--color-foreground-tertiary)]">€</span>
        </div>
        <div className="mt-1 font-mono text-xs text-[var(--color-foreground-tertiary)]">
          Deckt {trip.coversDays.join(" / ")} ab
        </div>
      </header>

      {Object.entries(byCategory).map(([cat, items]) => (
        <section
          key={cat}
          className="rounded-lg border border-[var(--color-border)] p-4"
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
  weekdaySlots: Record<number, MealSlots>;
  slotLabels: Record<string, string>;
}

function WeekView({ weekOverview, todayDate, weekdaySlots, slotLabels }: WeekViewProps) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {weekOverview.map((d) => {
        const isToday = d.date === todayDate;
        const isExpanded = expandedDate === d.date;
        const dayColors = colorsForDayType(d.dayType);
        // Look up by weekday (0=Sun..6=Sat) from the date string
        const weekday = new Date(d.date + "T00:00:00Z").getUTCDay();
        const slots = weekdaySlots[weekday];

        return (
          <div
            key={d.date}
            className={cn(
              "rounded-lg border border-[var(--color-border)] transition-colors",
              isToday && "bg-white/[0.04] ring-1 ring-[var(--color-foreground)]",
            )}
          >
            {/* Clickable header */}
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between gap-3 p-3 text-left hover:bg-white/[0.03]"
              onClick={() => setExpandedDate((prev) => (prev === d.date ? null : d.date))}
            >
              <div className="flex items-center gap-3">
                <div
                  className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium"
                  style={{ backgroundColor: dayColors.bg, color: dayColors.color }}
                >
                  {DAY_TYPE_LABEL[d.dayType]}
                </div>
                <div>
                  <div className="text-sm font-medium">{d.dayOfWeek}</div>
                  <div className="font-mono text-[11px] text-[var(--color-foreground-tertiary)]">{d.date}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm">{d.mainMealRecipeName ?? d.recipeName}</div>
                  {d.dinnerRecipeName && d.dinnerRecipeName !== d.mainMealRecipeName && (
                    <div className="font-mono text-[11px] text-[var(--color-foreground-tertiary)]">
                      + {d.dinnerRecipeName}
                    </div>
                  )}
                  {d.isCookDay && (
                    <div className="mt-0.5 inline-flex items-center gap-1 rounded-[3px] bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-foreground-secondary)]">
                      <ChefHat className="h-3 w-3" /> Kochtag
                    </div>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-[var(--color-foreground-tertiary)] transition-transform duration-200",
                    isExpanded && "rotate-180",
                  )}
                />
              </div>
            </button>

            {/* Expanded meal slots */}
            {isExpanded && slots && (
              <div className="space-y-2 border-t border-[var(--color-border)] px-3 pt-3 pb-3">
                {(Object.keys(slots) as (keyof MealSlots)[]).map((key) => {
                  const slot = slots[key];
                  if (!slot || slot.items.length === 0) return null;
                  return (
                    <SlotCard
                      key={key}
                      label={slotLabels[key] ?? key}
                      slot={slot}
                      adjusted={false}
                      flexible={slot.flexible}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
