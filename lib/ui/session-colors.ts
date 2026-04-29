// Direction C session-type → color mapping (Sprint v0.11).
//
// Pure data module. Every UI surface that knows a session's type MUST go
// through `getSessionColor(type)` for color selection — no manual color
// assignment per component, otherwise the visual language drifts.
import type { SessionType } from "@/lib/coach-engine/types";

interface SessionColorMap {
  /** Foreground color (used for text + stripe-border + chip-bg-tint). */
  color: string;
  /** Subtle background tint (used for calendar day cells, chip backgrounds). */
  bg: string;
  /** Tailwind class name for the left-stripe variant (see globals.css). */
  stripe: string;
  /** Human-readable session label (de-DE) for UI display. */
  label: string;
}

export const SESSION_COLORS: Record<string, SessionColorMap> = {
  easy_run:        { color: "var(--color-session-easy)",        bg: "var(--color-session-easy-bg)",        stripe: "session-stripe-easy",        label: "Easy" },
  threshold_run:   { color: "var(--color-session-threshold)",   bg: "var(--color-session-threshold-bg)",   stripe: "session-stripe-threshold",   label: "Threshold" },
  tempo_run:       { color: "var(--color-session-threshold)",   bg: "var(--color-session-threshold-bg)",   stripe: "session-stripe-threshold",   label: "Tempo" },
  long_run:        { color: "var(--color-session-long)",        bg: "var(--color-session-long-bg)",        stripe: "session-stripe-long",        label: "Long Run" },
  vo2max_intervals:{ color: "var(--color-session-vo2max)",      bg: "var(--color-session-vo2max-bg)",      stripe: "session-stripe-vo2max",      label: "VO2max" },
  calibration_run: { color: "var(--color-session-calibration)", bg: "var(--color-session-calibration-bg)", stripe: "session-stripe-calibration", label: "Calibration" },
  strength_a:      { color: "var(--color-session-strength)",    bg: "var(--color-session-strength-bg)",    stripe: "session-stripe-strength",    label: "Strength A" },
  strength_b:      { color: "var(--color-session-strength)",    bg: "var(--color-session-strength-bg)",    stripe: "session-stripe-strength",    label: "Strength B" },
  strength_c:      { color: "var(--color-session-strength)",    bg: "var(--color-session-strength-bg)",    stripe: "session-stripe-strength",    label: "Strength C" },
  rest:            { color: "var(--color-session-rest)",        bg: "var(--color-session-rest-bg)",        stripe: "session-stripe-rest",        label: "Rest" },
  active_recovery: { color: "var(--color-session-easy)",        bg: "var(--color-session-easy-bg)",        stripe: "session-stripe-easy",        label: "Recovery" },
  time_trial_5k:   { color: "var(--color-session-vo2max)",      bg: "var(--color-session-vo2max-bg)",      stripe: "session-stripe-vo2max",      label: "Time Trial" },
};

export function getSessionColor(type: SessionType | string): SessionColorMap {
  return SESSION_COLORS[type] ?? SESSION_COLORS["rest"];
}
