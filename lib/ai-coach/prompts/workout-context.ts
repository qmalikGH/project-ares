// Workout-context formatter — pure. Always-on baseline context for the AI-Coach
// (free-chat, daily-explanation, block-review).
//
// CLAUDE.md Rule 3: AI explains, never invents. The coach needs the full plan
// snapshot up front so it can answer "what's today's strength?" with concrete
// engine-generated values instead of guessing.

import type { FinalSession, SessionPlan } from "@/lib/coach-engine/types";

export interface WorkoutContextRecentCompleted {
  date: Date;
  type: string;
  rpe: number | null;
  durationActualMin: number | null;
  notes: string | null;
  wasModified: boolean;
  modifications: string[];
}

export interface WorkoutContextBlockPosition {
  blockNumber: number;
  phaseName: string;
  weekInBlock: number;
  weeksTotal: number;
  /** null when not yet in Block 5. */
  daysToNextTimeTrial: number | null;
}

export interface WorkoutContextInput {
  today: {
    plannedSessions: SessionPlan[];
    /** null when morning-input hasn't been submitted (no modulation possible yet). */
    finalSessions: FinalSession[] | null;
  };
  recentCompleted: WorkoutContextRecentCompleted[];
  /** Next 7 days of planned sessions (raw plan, before modulation). */
  upcoming: SessionPlan[];
  blockPosition: WorkoutContextBlockPosition;
}

/**
 * Format the workout context as a structured Markdown block. Pure.
 */
export function formatWorkoutContext(ctx: WorkoutContextInput): string {
  const lines: string[] = [];

  // 1. Today
  lines.push("## Heutiges Training");
  if (ctx.today.finalSessions === null) {
    lines.push(
      "Morning Check-in noch nicht abgeschlossen — Sessions sind geplant aber noch nicht modulated.",
    );
    if (ctx.today.plannedSessions.length === 0) {
      lines.push("(Keine Sessions für heute geplant — Rest-Tag.)");
    } else {
      for (const s of ctx.today.plannedSessions) {
        lines.push(formatSession(s, false));
      }
    }
  } else if (ctx.today.finalSessions.length === 0) {
    lines.push("(Keine Sessions für heute geplant — Rest-Tag.)");
  } else {
    for (const s of ctx.today.finalSessions) {
      lines.push(formatSession(s, true));
    }
  }

  // 2. Block-Position
  lines.push("");
  lines.push("## Block-Position");
  lines.push(
    `Block ${ctx.blockPosition.blockNumber} (${ctx.blockPosition.phaseName}), Woche ${ctx.blockPosition.weekInBlock} von ${ctx.blockPosition.weeksTotal}`,
  );
  if (ctx.blockPosition.daysToNextTimeTrial !== null) {
    const d = ctx.blockPosition.daysToNextTimeTrial;
    if (d === 0) {
      lines.push("Heute ist Time-Trial-Tag.");
    } else {
      lines.push(`${d} Tage bis zum nächsten 5k Time Trial`);
    }
  }

  // 3. Upcoming
  lines.push("");
  lines.push("## Nächste 7 Tage (geplant, noch nicht modulated)");
  const upcomingShown = ctx.upcoming.slice(0, 14); // up to 2 sessions/day × 7 days
  if (upcomingShown.length === 0) {
    lines.push("(Keine kommenden Sessions im Plan.)");
  } else {
    for (const s of upcomingShown) {
      const dateStr = toDateKey(s.date);
      const meta: string[] = [s.type];
      if (s.durationMin) meta.push(`${s.durationMin}min`);
      if (s.intensityZone) meta.push(`Z${s.intensityZone}`);
      lines.push(`${dateStr}: ${meta.join(" · ")}`);
    }
  }

  // 4. Recent completed
  lines.push("");
  lines.push("## Letzte abgeschlossene Sessions");
  if (ctx.recentCompleted.length === 0) {
    lines.push("Noch keine abgeschlossenen Sessions.");
  } else {
    for (const w of ctx.recentCompleted) {
      const dateStr = toDateKey(w.date);
      const modNote =
        w.wasModified && w.modifications.length > 0
          ? ` [modulated: ${w.modifications.join("; ")}]`
          : w.wasModified
          ? " [modulated]"
          : "";
      const rpe = w.rpe == null ? "—" : `RPE ${w.rpe}`;
      const dur = w.durationActualMin == null ? "—" : `${w.durationActualMin}min`;
      lines.push(`${dateStr}: ${w.type} · ${rpe} · ${dur}${modNote}`);
      if (w.notes) lines.push(`  Notizen: ${w.notes}`);
    }
  }

  return lines.join("\n");
}

function formatSession(session: SessionPlan | FinalSession, isModulated: boolean): string {
  const lines: string[] = [];
  const head = `### ${session.type}${session.durationMin ? ` (${session.durationMin}min)` : ""}`;
  lines.push(head);

  if (session.paceTarget) {
    const pace = `${session.paceTarget.from}${session.paceTarget.from !== session.paceTarget.to ? `–${session.paceTarget.to}` : ""}/km`;
    const zone = session.intensityZone ? `, Zone ${session.intensityZone}` : "";
    lines.push(`Pace: ${pace}${zone}`);
  } else if (session.intensityZone) {
    lines.push(`Zone: ${session.intensityZone}`);
  }
  if (session.rpeTarget != null) {
    lines.push(`RPE-Ziel: ${session.rpeTarget}`);
  }

  if (session.exercises && session.exercises.length > 0) {
    lines.push("Übungen:");
    let lastSupersetGroup: string | null | undefined = undefined;
    for (const ex of session.exercises) {
      const grp = ex.supersetGroup ?? null;

      // Open / close superset banner whenever the group changes.
      if (grp !== lastSupersetGroup) {
        if (grp != null) {
          const rationale = ex.supersetRationale ? ` — ${ex.supersetRationale}` : "";
          lines.push(`  Superset ${grp}${rationale}:`);
        }
        lastSupersetGroup = grp;
      }

      const parts: string[] = [`${ex.sets} × ${ex.reps}`];
      if (ex.loadPct != null) parts.push(`@ ${Math.round(ex.loadPct)}%`);
      if (ex.tempo) parts.push(`Tempo ${ex.tempo}`);
      if (ex.restSec != null) {
        if (grp != null && ex.supersetOrder === 1) {
          parts.push(`direkt zu B (0–15s)`);
        } else if (grp != null && ex.supersetOrder === 2) {
          parts.push(`Pause nach Paar ${formatRest(ex.restSec)}`);
        } else {
          parts.push(`Pause ${formatRest(ex.restSec)}`);
        }
      }
      if (ex.rpeCap != null) parts.push(`RPE-Cap ${ex.rpeCap}`);

      const indent = grp != null ? "    " : "  - ";
      const orderTag =
        grp != null && ex.supersetOrder != null ? `${grp}.${ex.supersetOrder} ` : "";
      lines.push(`${indent}${orderTag}${ex.name}: ${parts.join(", ")}`);
      if (ex.notes) lines.push(`${grp != null ? "      " : "    "}Notiz: ${ex.notes}`);
    }
  }

  if (
    isModulated &&
    "wasModified" in session &&
    session.wasModified &&
    session.modifications.length > 0
  ) {
    lines.push("Modulationen:");
    for (const m of session.modifications) lines.push(`  - ${m}`);
  }

  if (session.notes) {
    lines.push(`Hinweis: ${session.notes}`);
  }

  return lines.join("\n");
}

function formatRest(restSec: number): string {
  if (restSec >= 60 && restSec % 60 === 0) return `${restSec / 60}min`;
  if (restSec >= 60) return `${(restSec / 60).toFixed(1)}min`;
  return `${restSec}s`;
}

function toDateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
