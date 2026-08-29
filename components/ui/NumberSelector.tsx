"use client";

// Tap-grid number selector — extracted from TodayDashboard in Sprint 3.0.
//
// It replaced <input type="range"> on the morning ritual because a range slider
// is imprecise on a phone. The confirmation screen needs the same control for
// RPE and shin NRS, so it now lives here instead of being file-local.
//
// Two things are configurable that were hardcoded before:
//   - `min`, because a pain NRS starts at 0 ("no pain") while RPE starts at 1.
//   - `thresholds`, because the colour bands must match whichever engine rule
//     reads the value. The old fixed 7/4 split painted a shin of 6 yellow while
//     the HSR gate (block-transition.ts) treats >5 as a step-back — the colour
//     told the athlete the opposite of what the engine was about to do.

import { cn } from "@/lib/utils";

type Severity = "good" | "ok" | "bad";

export interface SeverityThresholds {
  /** value >= high → the "high" band */
  high: number;
  /** value >= mid → the "mid" band */
  mid: number;
}

export const DEFAULT_THRESHOLDS: SeverityThresholds = { high: 7, mid: 4 };

/** Shin NRS: ≤3 progress · 4–5 hold · >5 step back (block-transition.ts:178-190). */
export const SHIN_THRESHOLDS: SeverityThresholds = { high: 6, mid: 4 };

export function severity(
  n: number,
  highIsGood: boolean,
  thresholds: SeverityThresholds = DEFAULT_THRESHOLDS,
): Severity {
  const level = n >= thresholds.high ? "high" : n >= thresholds.mid ? "mid" : "low";
  const map = highIsGood
    ? { high: "good", mid: "ok", low: "bad" }
    : { high: "bad", mid: "ok", low: "good" };
  return map[level] as Severity;
}

export const SEV_TEXT: Record<Severity, string> = {
  good: "text-emerald-400",
  ok: "text-yellow-300",
  bad: "text-red-400",
};

export const SEV_BUTTON: Record<Severity, string> = {
  good: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  ok: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  bad: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function NumberSelector({
  label,
  hint,
  value,
  onChange,
  highIsGood = true,
  min = 1,
  max = 10,
  thresholds = DEFAULT_THRESHOLDS,
}: {
  label: string;
  hint: string;
  /** null renders the control with nothing selected — "not answered yet". */
  value: number | null;
  onChange: (v: number) => void;
  highIsGood?: boolean;
  min?: number;
  max?: number;
  thresholds?: SeverityThresholds;
}) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-sm font-medium text-[var(--text-primary)]">{label}</label>
        <span
          className={cn(
            "text-sm font-bold tabular-nums transition-colors",
            value === null
              ? "text-[var(--text-tertiary)]"
              : SEV_TEXT[severity(value, highIsGood, thresholds)],
          )}
        >
          {value === null ? `—/${max}` : `${value}/${max}`}
        </span>
      </div>
      <div className="flex gap-1">
        {options.map((n) => {
          const isSelected = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange(n)}
              className={cn(
                "flex h-8 min-w-0 flex-1 items-center justify-center rounded border",
                "text-xs font-medium transition-all duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-ring)]",
                isSelected
                  ? SEV_BUTTON[severity(n, highIsGood, thresholds)]
                  : "border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-tertiary)] hover:bg-white/[0.07] hover:text-[var(--text-secondary)]",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">{hint}</p>
    </div>
  );
}
