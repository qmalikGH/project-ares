// Sprint 2.5 — the modulator may slow a session down, never speed it up.
//
// The bug this locks out: the YELLOW rule wrote a hardcoded "5:05" (a VDOT-42
// marathon pace). At VDOT 35 the threshold pace is 5:31, so the rule meant to
// make a low-readiness day easier prescribed 26 s/km FASTER. The property test
// below covers every readiness band × VDOT in the table, so any future rule
// that reaches for a constant fails here.
import { describe, it, expect } from "vitest";

import { modulateSession } from "@/lib/coach-engine/session-modulator";
import { vdotToPaces, paceStringToMinPerKm } from "@/lib/coach-engine/run-coach";
import type {
  LimitationsOutput,
  LoadOutput,
  ReadinessBand,
  ReadinessOutput,
  SessionPlan,
} from "@/lib/coach-engine/types";

const VDOTS = [35, 36, 38, 40, 42, 44, 46, 48, 50];
const BANDS: ReadinessBand[] = ["GREEN", "YELLOW", "ORANGE", "RED"];

function readiness(band: ReadinessBand): ReadinessOutput {
  const score = { GREEN: 85, YELLOW: 70, ORANGE: 55, RED: 40 }[band];
  return {
    score,
    band,
    components: { hrv: score, sleep: score, battery: score, rhrDev: score, subjective: score, knee: 90 },
    trend7d: "stable",
  };
}

const calmLoad: LoadOutput = {
  dailyLoadAu: 0,
  acute7d: 100,
  chronic28d: 100,
  acwrRolling: 1.0,
  acwrEwma: 1.0,
  band: "OPTIMAL",
  daysOfData: 28,
};

const calmLimits: LimitationsOutput = {
  kneeScoreToday: 1,
  kneeBaseline28d: 1,
  kneeTrend7d: "stable",
  therapyPhase: "REMODELING",
  constraints: [],
  illnessRecoveryDays: null,
};

function thresholdSession(vdot: number): SessionPlan {
  const paces = vdotToPaces(vdot);
  return {
    date: new Date("2026-08-11T00:00:00.000Z"),
    type: "threshold_run",
    durationMin: 50,
    paceTarget: { from: paces.T, to: paces.T },
    intensityZone: 2,
    zoneLabel: "Threshold",
    rpeTarget: 7,
  };
}

describe("modulation never speeds a session up", () => {
  it("holds across every readiness band and every VDOT in the table", () => {
    for (const vdot of VDOTS) {
      const paces = vdotToPaces(vdot);
      for (const band of BANDS) {
        const planned = thresholdSession(vdot);
        const out = modulateSession(planned, readiness(band), calmLoad, calmLimits, paces);
        if (!out.paceTarget) continue; // cleared → unpaced easy session, fine
        const plannedFrom = paceStringToMinPerKm(planned.paceTarget!.from);
        const plannedTo = paceStringToMinPerKm(planned.paceTarget!.to);
        expect(
          paceStringToMinPerKm(out.paceTarget.from),
          `vdot ${vdot} band ${band} (from)`,
        ).toBeGreaterThanOrEqual(plannedFrom);
        expect(
          paceStringToMinPerKm(out.paceTarget.to),
          `vdot ${vdot} band ${band} (to)`,
        ).toBeGreaterThanOrEqual(plannedTo);
      }
    }
  });

  it("YELLOW downgrades threshold to the athlete's OWN marathon pace", () => {
    const paces = vdotToPaces(35);
    const out = modulateSession(thresholdSession(35), readiness("YELLOW"), calmLoad, calmLimits, paces);
    expect(out.type).toBe("tempo_run");
    expect(out.paceTarget).toEqual({ from: paces.M, to: paces.M });
    // The regression itself: the old constant was faster than VDOT-35 T-pace.
    expect(paceStringToMinPerKm(paces.M)).toBeGreaterThan(paceStringToMinPerKm(paces.T));
    expect(paceStringToMinPerKm("5:05")).toBeLessThan(paceStringToMinPerKm(paces.T));
  });

  it("without paces it downgrades the type but invents no number", () => {
    const planned = thresholdSession(35);
    const out = modulateSession(planned, readiness("YELLOW"), calmLoad, calmLimits);
    expect(out.type).toBe("tempo_run");
    expect(out.paceTarget).toEqual(planned.paceTarget);
    expect(out.modifications.join(" ")).toContain("Tempo");
  });

  it("still lets a rule clear the pace entirely (REACTIVE → easy run)", () => {
    const paces = vdotToPaces(35);
    const out = modulateSession(
      thresholdSession(35),
      readiness("GREEN"),
      calmLoad,
      { ...calmLimits, therapyPhase: "REACTIVE" },
      paces,
    );
    expect(out.type).toBe("easy_run");
    expect(out.paceTarget).toBeUndefined();
  });
});
