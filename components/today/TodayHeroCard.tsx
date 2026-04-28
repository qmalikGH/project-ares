"use client";

// TodayHeroCard (Sprint v0.8) — large glass-hero render of today's primary
// session. HR-First (cyan display-2xl) with pace as orientierend secondary.
// Drop-in replacement / partner to the legacy SessionBody used by /today.
//
// Visual layer only. Engine fields (hrTarget / paceTarget / intensityZone /
// controlMethod) come straight from SessionPlan and are rendered as-is.
import { cn } from "@/lib/utils";
import type { SessionPlan } from "@/lib/coach-engine/types";

type SessionStatus = "geplant" | "live" | "abgeschlossen";

const SESSION_LABEL: Record<string, string> = {
  easy_run: "Easy Run",
  threshold_run: "Threshold Run",
  tempo_run: "Tempo Run",
  vo2max_intervals: "VO2max Intervals",
  long_run: "Long Run",
  calibration_run: "Calibration Run",
  time_trial_5k: "5k Time Trial",
  strength_a: "Strength A · Lower",
  strength_b: "Strength B · Upper",
  strength_c: "Strength C · Mixed",
  rest: "Rest Day",
  active_recovery: "Active Recovery",
  cross_training: "Cross-training",
  mobility: "Mobility",
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const config = {
    geplant: {
      label: "Geplant",
      className: "border-[var(--border-strong)] text-[var(--text-secondary)]",
    },
    live: {
      label: "Live",
      className:
        "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]",
    },
    abgeschlossen: {
      label: "Abgeschlossen",
      className:
        "border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)]",
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

export function TodayHeroCard({
  date,
  blockLabel,
  session,
  status,
}: {
  /** Display string e.g. "Dienstag, 28. April 2026" */
  date: string;
  /** Display string e.g. "Block 1 · Aerobic Base · Woche 2" */
  blockLabel: string;
  session: SessionPlan;
  status: SessionStatus;
}) {
  const sessionTypeLabel = SESSION_LABEL[session.type] ?? session.type;
  const isPaceFirst = session.controlMethod === "pace_first";

  const pace = session.paceTarget;
  const paceDisplay = pace
    ? pace.from === pace.to
      ? pace.from
      : `${pace.from}–${pace.to}`
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-display-lg text-[var(--text-primary)]">{date}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{blockLabel}</p>
        </div>
        <StatusBadge status={status} />
      </header>

      {/* Hero card */}
      <div className="glass-card-hero p-6 sm:p-8">
        <div className="relative z-[1]">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {sessionTypeLabel}
            </h2>
            {session.durationMin && (
              <span className="tabular-nums text-sm text-[var(--text-secondary)]">
                {session.durationMin} min
              </span>
            )}
          </div>

          {/* Primary metric: HR (or pace if pace_first session like time-trial) */}
          {!isPaceFirst && session.hrTarget ? (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
                Herzfrequenz
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-display-2xl tabular-nums text-[var(--accent)]">
                  {session.hrTarget.from}–{session.hrTarget.to}
                </span>
                <span className="text-base text-[var(--text-secondary)]">
                  bpm
                </span>
              </div>
            </div>
          ) : paceDisplay ? (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
                Pace
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-display-2xl tabular-nums text-[var(--accent)]">
                  {paceDisplay}
                </span>
                <span className="text-base text-[var(--text-secondary)]">
                  /km
                </span>
              </div>
            </div>
          ) : null}

          {/* Secondary metric: pace orientierend (when HR is primary) */}
          {!isPaceFirst && session.hrTarget && paceDisplay && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
                Pace{" "}
                <span className="italic normal-case tracking-normal">
                  (orientierend)
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="tabular-nums text-lg text-[var(--text-secondary)]">
                  {paceDisplay}
                </span>
                <span className="text-sm text-[var(--text-tertiary)]">/km</span>
              </div>
            </div>
          )}

          {/* Zone + RPE pills */}
          <div className="mt-6 flex flex-wrap gap-2">
            {session.intensityZone && (
              <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                Zone {session.intensityZone}
              </span>
            )}
            {session.rpeTarget != null && (
              <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                RPE {session.rpeTarget}
              </span>
            )}
          </div>

          {session.notes && (
            <p className="mt-4 text-sm italic text-[var(--text-tertiary)]">
              {session.notes}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs italic text-[var(--text-tertiary)]">
        Sessions werden am Tag basierend auf deiner Recovery (HRV, Sleep, Knee)
        automatisch angepasst.
      </p>
    </div>
  );
}
