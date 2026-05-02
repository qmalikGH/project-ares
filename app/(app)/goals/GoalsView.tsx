"use client";

// Sprint v0.14: Goals hierarchy page — Vision → AnnualGoal → Macrocycle.
// Direction C styling. Three vertical sections with progress bars.
// First-time setup flow when no Vision exists.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/training/shared";

// ============================================
// Types (matching API responses)
// ============================================

interface GoalDims {
  "5k"?: string;
  "10k"?: string;
  hm?: string;
  marathon?: string;
  ironman?: string;
  vo2max?: number;
  hexBarDl?: number;
  convDl?: number;
  bench?: number;
  squat?: number;
  weight?: number;
  bodyFatPct?: number;
}

interface VisionData {
  id: string;
  targets: GoalDims;
  timeHorizon: string;
  notes?: string;
  annualGoals: AnnualGoalData[];
}

interface AnnualGoalData {
  id: string;
  targets: GoalDims;
  startDate: string;
  targetDate: string;
  notes?: string;
  macrocycles: MacrocycleData[];
}

interface MacrocycleData {
  id: string;
  focusMode?: string;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  status: string;
  evaluatedAt?: string;
}

// ============================================
// Dimension rendering config
// ============================================

const DIMENSION_CONFIG: {
  key: keyof GoalDims;
  label: string;
  unit: string;
  format: (v: string | number) => string;
}[] = [
  { key: "5k", label: "5k", unit: "", format: (v) => String(v) },
  { key: "10k", label: "10k", unit: "", format: (v) => String(v) },
  { key: "hm", label: "Halbmarathon", unit: "", format: (v) => String(v) },
  { key: "marathon", label: "Marathon", unit: "", format: (v) => String(v) },
  { key: "ironman", label: "Ironman", unit: "", format: (v) => String(v) },
  { key: "vo2max", label: "VO2max", unit: "ml/kg/min", format: (v) => `${v}` },
  { key: "hexBarDl", label: "Hex Bar DL", unit: "kg", format: (v) => `${v} kg` },
  { key: "convDl", label: "Conv. DL", unit: "kg", format: (v) => `${v} kg` },
  { key: "bench", label: "Bench Press", unit: "kg", format: (v) => `${v} kg` },
  { key: "squat", label: "Squat", unit: "kg", format: (v) => `${v} kg` },
  { key: "weight", label: "Gewicht", unit: "kg", format: (v) => `${v} kg` },
  { key: "bodyFatPct", label: "KFA", unit: "%", format: (v) => `${v}%` },
];

// ============================================
// Default targets (pre-fill from sprint v0.14 prompt)
// ============================================

const DEFAULT_VISION_TARGETS: GoalDims = {
  "5k": "17:30",
  "10k": "37:00",
  hm: "1:22:00",
  marathon: "3:00:00",
  ironman: "sub-12h",
  vo2max: 58,
  hexBarDl: 205,
  convDl: 200,
  bench: 125,
  squat: 170,
  weight: 82,
  bodyFatPct: 10,
};

const DEFAULT_ANNUAL_TARGETS: GoalDims = {
  "5k": "20:00",
  "10k": "42:00",
  hm: "1:35:00",
  vo2max: 52,
  hexBarDl: 180,
  convDl: 170,
  bench: 110,
  squat: 140,
  weight: 85,
  bodyFatPct: 14,
};

// ============================================
// Main component
// ============================================

export default function GoalsView() {
  const router = useRouter();
  const [vision, setVision] = React.useState<VisionData | null>(null);
  const [annualGoal, setAnnualGoal] = React.useState<AnnualGoalData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [setupStep, setSetupStep] = React.useState<0 | 1 | 2 | 3>(0);
  const [saving, setSaving] = React.useState(false);

  // Setup form state
  const [visionTargets, setVisionTargets] = React.useState<GoalDims>(DEFAULT_VISION_TARGETS);
  const [annualTargets, setAnnualTargets] = React.useState<GoalDims>(DEFAULT_ANNUAL_TARGETS);

  React.useEffect(() => {
    async function load() {
      try {
        const [vRes, aRes] = await Promise.all([
          fetch("/api/goals/vision"),
          fetch("/api/goals/annual"),
        ]);
        const vData = await vRes.json();
        const aData = await aRes.json();
        setVision(vData.vision ?? null);
        setAnnualGoal(aData.annualGoal ?? null);
        if (!vData.vision) setSetupStep(1);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ─── Setup flow handlers ──────────────���──

  async function handleSetupVision() {
    setSaving(true);
    try {
      const res = await fetch("/api/goals/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: visionTargets, timeHorizon: "3-5 years" }),
      });
      const data = await res.json();
      setVision(data.vision);
      setSetupStep(2);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetupAnnual() {
    if (!vision) return;
    setSaving(true);
    try {
      const now = new Date();
      const targetDate = new Date(now.getTime() + 18 * 30 * 86400000); // ~18 months
      const res = await fetch("/api/goals/annual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visionId: vision.id,
          targets: annualTargets,
          startDate: now.toISOString(),
          targetDate: targetDate.toISOString(),
        }),
      });
      const data = await res.json();
      setAnnualGoal(data.annualGoal);
      setSetupStep(3);
    } finally {
      setSaving(false);
    }
  }

  function handleSetupComplete() {
    setSetupStep(0);
    router.refresh();
  }

  // ─── Loading ─────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-[var(--color-surface)]" />
          <div className="h-64 rounded bg-[var(--color-surface)]" />
        </div>
      </div>
    );
  }

  // ─── Setup flow ─────────────────

  if (setupStep > 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-lg font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground-secondary)] mb-6">
          Ziel-Setup
        </h1>

        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s <= setupStep
                  ? "bg-[var(--color-session-calibration)]"
                  : "bg-[var(--color-foreground-muted)]"
              }`}
            />
          ))}
        </div>

        {setupStep === 1 && (
          <Card>
            <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--color-foreground-secondary)] mb-1">
              Vision · 3–5 Jahre
            </h2>
            <p className="text-xs text-[var(--color-foreground-tertiary)] mb-4">
              Wo willst du langfristig hin? Die Defaults basieren auf deinem Athleten-Profil.
            </p>
            <DimensionForm targets={visionTargets} onChange={setVisionTargets} />
            <button
              onClick={handleSetupVision}
              disabled={saving}
              className="mt-6 w-full rounded-lg bg-[var(--color-session-calibration)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Speichern..." : "Weiter → Jahresziel"}
            </button>
          </Card>
        )}

        {setupStep === 2 && (
          <Card>
            <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--color-foreground-secondary)] mb-1">
              Jahresziel · 12–18 Monate
            </h2>
            <p className="text-xs text-[var(--color-foreground-tertiary)] mb-4">
              Was ist in den nächsten 12–18 Monaten realistisch erreichbar?
            </p>
            <DimensionForm targets={annualTargets} onChange={setAnnualTargets} />
            <button
              onClick={handleSetupAnnual}
              disabled={saving}
              className="mt-6 w-full rounded-lg bg-[var(--color-session-calibration)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Speichern..." : "Weiter → Bestätigung"}
            </button>
          </Card>
        )}

        {setupStep === 3 && (
          <Card>
            <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--color-foreground-secondary)] mb-1">
              Bestätigung
            </h2>
            <p className="text-xs text-[var(--color-foreground-tertiary)] mb-4">
              Deine Ziel-Hierarchie ist eingerichtet. Der aktuelle Makrozyklus wird automatisch verknüpft.
            </p>
            <div className="space-y-3">
              <SummaryBlock label="Vision (3–5J)" targets={visionTargets} />
              <div className="h-px bg-[var(--color-rule)]" />
              <SummaryBlock label="Jahresziel (12–18M)" targets={annualTargets} />
            </div>
            <button
              onClick={handleSetupComplete}
              className="mt-6 w-full rounded-lg bg-[var(--color-session-calibration)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Fertig
            </button>
          </Card>
        )}
      </div>
    );
  }

  // ─── Main view (Vision + AnnualGoal + Macrocycle) ─────

  const activeMacrocycle = annualGoal?.macrocycles?.find((m) => m.status === "active");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 pb-32 space-y-6">
      {/* VISION */}
      {vision && (
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground-muted)] mb-4">
            Vision · {vision.timeHorizon}
          </h2>
          <DimensionList targets={vision.targets} />
        </Card>
      )}

      {/* ANNUAL GOAL */}
      {annualGoal && (
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground-muted)] mb-4">
            Jahresziel · {formatDateRange(annualGoal.startDate, annualGoal.targetDate)}
          </h2>
          <DimensionList targets={annualGoal.targets} />
        </Card>
      )}

      {/* CURRENT MACROCYCLE */}
      <Card>
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground-muted)] mb-4">
          Aktueller Makrozyklus
          {activeMacrocycle?.focusMode && activeMacrocycle.focusMode !== "balanced" && (
            <span className="ml-2 inline-block rounded-full bg-[var(--color-session-calibration)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-session-calibration)]">
              {FOCUS_LABELS[activeMacrocycle.focusMode] ?? activeMacrocycle.focusMode}
            </span>
          )}
        </h2>
        {activeMacrocycle ? (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-[var(--color-foreground-secondary)]">
                {formatDateRange(activeMacrocycle.startDate, activeMacrocycle.endDate)}
              </span>
              <span className="num text-xs text-[var(--color-foreground-tertiary)]">
                {activeMacrocycle.totalWeeks} Wochen
              </span>
            </div>
            <button
              onClick={() => router.push("/goals/evaluate")}
              className="w-full rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-foreground-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Evaluieren →
            </button>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-foreground-tertiary)]">
            Kein aktiver Makrozyklus.
          </p>
        )}
      </Card>
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

const FOCUS_LABELS: Record<string, string> = {
  strength_focus: "Kraft-Fokus",
  endurance_focus: "Ausdauer-Fokus",
  recomp: "Recomposition",
  balanced: "Balanced",
};

function DimensionList({ targets }: { targets: GoalDims }) {
  return (
    <div className="space-y-2">
      {DIMENSION_CONFIG.map((dim) => {
        const value = targets[dim.key];
        if (value === undefined || value === null) return null;
        return (
          <div key={dim.key} className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-foreground-secondary)]">
              {dim.label}
            </span>
            <span className="num text-sm text-[var(--color-foreground)]">
              {dim.format(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DimensionForm({
  targets,
  onChange,
}: {
  targets: GoalDims;
  onChange: (t: GoalDims) => void;
}) {
  function update(key: keyof GoalDims, raw: string) {
    const isNumeric = ["vo2max", "hexBarDl", "convDl", "bench", "squat", "weight", "bodyFatPct"].includes(key);
    const value = isNumeric ? (raw === "" ? undefined : Number(raw)) : raw || undefined;
    onChange({ ...targets, [key]: value });
  }

  return (
    <div className="space-y-3">
      {DIMENSION_CONFIG.map((dim) => {
        const value = targets[dim.key];
        return (
          <div key={dim.key} className="flex items-center gap-3">
            <label className="w-32 text-xs font-medium uppercase tracking-wide text-[var(--color-foreground-secondary)]">
              {dim.label}
            </label>
            <input
              type="text"
              value={value ?? ""}
              onChange={(e) => update(dim.key, e.target.value)}
              placeholder="—"
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-foreground-muted)] focus:border-[var(--color-session-calibration)] focus:outline-none"
            />
            {dim.unit && (
              <span className="w-16 text-xs text-[var(--color-foreground-tertiary)]">
                {dim.unit}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SummaryBlock({ label, targets }: { label: string; targets: GoalDims }) {
  const entries = DIMENSION_CONFIG.filter((d) => targets[d.key] !== undefined && targets[d.key] !== null);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)] mb-2">
        {label}
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {entries.map((dim) => (
          <div key={dim.key} className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--color-foreground-tertiary)]">{dim.label}</span>
            <span className="num text-xs text-[var(--color-foreground)]">
              {dim.format(targets[dim.key]!)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}
