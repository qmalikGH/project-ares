"use client";

// Sprint v0.14: Macrocycle evaluation page.
// Shows multi-dimensional gap analysis, focus recommendation, and next-cycle targets.
// Direction C styling.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/training/shared";

// ============================================
// Types (matching API responses)
// ============================================

interface DimensionEval {
  name: string;
  label: string;
  unit: string;
  startValue: number | string | null;
  endValue: number | string | null;
  annualTarget: number | string | null;
  gap: number | null;
  verdict: "achieved" | "on_track" | "behind" | "no_data";
}

interface EvaluationResult {
  dimensions: DimensionEval[];
  overallVerdict: "all_on_track" | "mixed" | "behind";
  suggestedFocus: string;
  suggestedFocusRationale: string;
  nextCycleTargets: Record<string, string | number>;
}

// ============================================
// Constants
// ============================================

const VERDICT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  achieved: {
    label: "✓ Erreicht",
    color: "text-[var(--color-success)]",
    bg: "bg-[var(--color-success)]/10",
  },
  on_track: {
    label: "⚡ On Track",
    color: "text-[var(--color-session-threshold)]",
    bg: "bg-[var(--color-session-threshold)]/10",
  },
  behind: {
    label: "⚠ Behind",
    color: "text-[var(--color-destructive)]",
    bg: "bg-[var(--color-destructive)]/10",
  },
  no_data: {
    label: "— Keine Daten",
    color: "text-[var(--color-foreground-muted)]",
    bg: "bg-[var(--color-foreground-muted)]/10",
  },
};

const FOCUS_LABELS: Record<string, string> = {
  strength_focus: "STRENGTH FOCUS",
  endurance_focus: "ENDURANCE FOCUS",
  recomp: "RECOMPOSITION",
  balanced: "BALANCED",
};

// ============================================
// Main component
// ============================================

export default function EvaluationView() {
  const router = useRouter();
  const [evaluation, setEvaluation] = React.useState<EvaluationResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editingTargets, setEditingTargets] = React.useState(false);
  const [nextTargets, setNextTargets] = React.useState<Record<string, string | number>>({});

  React.useEffect(() => {
    async function evaluate() {
      try {
        const res = await fetch("/api/goals/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
          return;
        }
        setEvaluation(data.evaluation);
        setNextTargets(data.evaluation.nextCycleTargets ?? {});
      } catch {
        setError("Evaluation fehlgeschlagen");
      } finally {
        setLoading(false);
      }
    }
    evaluate();
  }, []);

  async function handleConfirm() {
    if (!evaluation) return;
    setCreating(true);
    try {
      const res = await fetch("/api/goals/next-cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          focusMode: evaluation.suggestedFocus,
          targets: nextTargets,
          focusRationale: evaluation.suggestedFocusRationale,
        }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        router.push("/week");
      }
    } finally {
      setCreating(false);
    }
  }

  // ─── Loading ─────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-[var(--color-surface)]" />
          <div className="h-96 rounded bg-[var(--color-surface)]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <p className="text-sm text-[var(--color-destructive)]">{error}</p>
          <p className="text-xs text-[var(--color-foreground-tertiary)] mt-2">
            Stelle sicher, dass du eine Vision und ein Jahresziel eingerichtet hast.
          </p>
          <button
            onClick={() => router.push("/goals")}
            className="mt-4 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-foreground-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            Zu den Zielen
          </button>
        </Card>
      </div>
    );
  }

  if (!evaluation) return null;

  // ─── Evaluation view ─────────

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 pb-32 space-y-6">
      {/* Header */}
      <h1 className="text-lg font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground-secondary)]">
        Makrozyklus · Evaluation
      </h1>

      {/* Dimension table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-rule)]">
                <th className="pb-2 text-left font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
                  Dimension
                </th>
                <th className="pb-2 text-right font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
                  Start
                </th>
                <th className="pb-2 text-right font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
                  Ende
                </th>
                <th className="pb-2 text-right font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
                  Jahresz.
                </th>
                <th className="pb-2 text-right font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
                  Gap
                </th>
                <th className="pb-2 text-right font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-rule)]">
              {evaluation.dimensions.map((dim) => {
                const vs = VERDICT_STYLE[dim.verdict] ?? VERDICT_STYLE.no_data;
                return (
                  <tr key={dim.name}>
                    <td className="py-2 font-medium text-[var(--color-foreground-secondary)]">
                      {dim.label}
                    </td>
                    <td className="py-2 text-right num text-[var(--color-foreground-tertiary)]">
                      {dim.startValue ?? "—"}
                    </td>
                    <td className="py-2 text-right num text-[var(--color-foreground)]">
                      {dim.endValue ?? "—"}
                    </td>
                    <td className="py-2 text-right num text-[var(--color-foreground-tertiary)]">
                      {dim.annualTarget ?? "—"}
                    </td>
                    <td className="py-2 text-right num text-[var(--color-foreground-tertiary)]">
                      {dim.gap !== null ? `${dim.gap}%` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${vs.color} ${vs.bg}`}
                      >
                        {vs.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recommendation */}
      <Card>
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground-muted)] mb-3">
          Empfehlung nächster Zyklus
        </h2>
        <div className="flex items-center gap-3 mb-3">
          <span className="rounded-full bg-[var(--color-session-calibration)]/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--color-session-calibration)]">
            {FOCUS_LABELS[evaluation.suggestedFocus] ?? evaluation.suggestedFocus}
          </span>
        </div>
        <p className="text-sm text-[var(--color-foreground-secondary)] leading-relaxed">
          {evaluation.suggestedFocusRationale}
        </p>
      </Card>

      {/* Next targets */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground-muted)]">
            Nächste Ziele
          </h2>
          <button
            onClick={() => setEditingTargets(!editingTargets)}
            className="text-xs text-[var(--color-session-calibration)] hover:underline"
          >
            {editingTargets ? "Fertig" : "Anpassen"}
          </button>
        </div>
        <div className="space-y-2">
          {Object.entries(nextTargets).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-foreground-secondary)]">
                {key}
              </span>
              {editingTargets ? (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const isNum = !isNaN(Number(raw)) && raw !== "";
                    setNextTargets((prev) => ({
                      ...prev,
                      [key]: isNum ? Number(raw) : raw,
                    }));
                  }}
                  className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-right text-xs text-[var(--color-foreground)] focus:border-[var(--color-session-calibration)] focus:outline-none"
                />
              ) : (
                <span className="num text-sm text-[var(--color-foreground)]">
                  {value}
                </span>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Action buttons */}
      <div className="space-y-3">
        <button
          onClick={handleConfirm}
          disabled={creating}
          className="w-full rounded-lg bg-[var(--color-session-calibration)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Erstelle neuen Zyklus..." : "Bestätigen + Neuen Zyklus starten"}
        </button>
        <button
          onClick={() => setEditingTargets(true)}
          className="w-full rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-foreground-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Ziele anpassen
        </button>
      </div>
    </div>
  );
}
