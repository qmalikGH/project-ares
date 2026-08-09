// Sprint 2.6 (A6) — VDOT auto-calibration decider. Pure, no DB.
//
// The negative cases carry the weight here. Anything that lets an UPWARD move
// through is a decision to make the athlete run faster, and this module exists
// because that direction is the one with an injury cost.
import { describe, it, expect } from "vitest";

import {
  decideVdotUpdate,
  AUTO_MIN_DELTA,
  AUTO_MAX_STEP_UP,
  AUTO_MAX_STEP_DOWN,
  MANUAL_PIN_TTL_DAYS,
  VDOT_TABLE_MIN,
  VDOT_TABLE_MAX,
  VDOT_SOURCE_MANUAL,
  VDOT_SOURCE_AUTO,
  type VdotAutoInput,
} from "@/lib/coach-engine/vdot-autocalibration";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";

const NOW = new Date("2026-08-10T06:00:00.000Z");

function input(over: Partial<VdotAutoInput> = {}): VdotAutoInput {
  return {
    currentVdot: 38,
    calibration: { finalVdot: 38, confidence: "high", insufficientData: false },
    vdotSource: VDOT_SOURCE_AUTO,
    vdotSetAt: new Date("2026-07-01T00:00:00.000Z"),
    layoffActive: false,
    volumeGate: "progress",
    now: NOW,
    ...over,
  };
}

describe("no measurement, no move", () => {
  it("insufficient data never applies", () => {
    const d = decideVdotUpdate(
      input({ calibration: { finalVdot: 0, confidence: "low", insufficientData: true } }),
    );
    expect(d.status).toBe("insufficient_data");
    expect(d.newVdot).toBeNull();
  });

  it("a delta below the hysteresis band is ignored in both directions", () => {
    expect(
      decideVdotUpdate(input({ calibration: { finalVdot: 39, confidence: "high", insufficientData: false } })).status,
    ).toBe("below_delta");
    expect(
      decideVdotUpdate(input({ calibration: { finalVdot: 37, confidence: "high", insufficientData: false } })).status,
    ).toBe("below_delta");
    // …and exactly at the band it does move.
    expect(
      decideVdotUpdate(
        input({ calibration: { finalVdot: 38 + AUTO_MIN_DELTA, confidence: "high", insufficientData: false } }),
      ).status,
    ).toBe("applied");
  });
});

describe("the asymmetry — this is the safety argument", () => {
  const measuredUp = { finalVdot: 42, confidence: "low" as const, insufficientData: false };
  const measuredDown = { finalVdot: 34, confidence: "low" as const, insufficientData: false };
  const trustedDown = { finalVdot: 34, confidence: "high" as const, insufficientData: false };

  it("low confidence is rejected in BOTH directions", () => {
    // Found by running the real June window: linear_regression extrapolated far
    // outside its sample and returned 24 beside HRC's 44; the weighted mean (34)
    // was worse than either. A drop applied on that basis would re-create the
    // under-training loop this module exists to break.
    expect(decideVdotUpdate(input({ calibration: measuredUp })).status).toBe("low_confidence");
    expect(decideVdotUpdate(input({ calibration: measuredDown })).status).toBe("low_confidence");
  });

  it("DOWN on a trustworthy measurement is applied without state gates", () => {
    const d = decideVdotUpdate(
      input({ calibration: { ...measuredDown, confidence: "medium" } }),
    );
    expect(d.status).toBe("applied");
    expect(d.direction).toBe("down");
    expect(d.newVdot).toBeLessThan(38);
  });

  it("UP is blocked during the comeback ramp, DOWN is not", () => {
    const up = decideVdotUpdate(
      input({ layoffActive: true, calibration: { ...measuredUp, confidence: "high" } }),
    );
    expect(up.status).toBe("blocked_comeback");
    expect(up.newVdot).toBeNull();

    const down = decideVdotUpdate(input({ layoffActive: true, calibration: trustedDown }));
    expect(down.status).toBe("applied");
  });

  it("UP is blocked while the shin gate holds or regresses, DOWN is not", () => {
    for (const gate of ["hold", "regress"] as const) {
      const up = decideVdotUpdate(
        input({ volumeGate: gate, calibration: { ...measuredUp, confidence: "high" } }),
      );
      expect(up.status).toBe("blocked_shin");
      expect(up.newVdot).toBeNull();

      const down = decideVdotUpdate(input({ volumeGate: gate, calibration: trustedDown }));
      expect(down.status).toBe("applied");
    }
  });

  it("every rejection leaves the athlete on the slower of the two values", () => {
    const rejections = [
      decideVdotUpdate(input({ calibration: measuredUp })),
      decideVdotUpdate(input({ layoffActive: true, calibration: { ...measuredUp, confidence: "high" } })),
      decideVdotUpdate(input({ volumeGate: "regress", calibration: { ...measuredUp, confidence: "high" } })),
    ];
    for (const d of rejections) {
      expect(d.newVdot).toBeNull(); // → caller keeps currentVdot, which is lower than measured
      expect(d.measuredVdot).toBeGreaterThan(d.currentVdot);
    }
  });
});

describe("step caps", () => {
  it("caps a large rise at AUTO_MAX_STEP_UP", () => {
    const d = decideVdotUpdate(
      input({ calibration: { finalVdot: 46, confidence: "high", insufficientData: false } }),
    );
    expect(d.newVdot).toBe(38 + AUTO_MAX_STEP_UP);
    expect(d.reason).toContain("begrenzt");
  });

  it("caps a large drop at AUTO_MAX_STEP_DOWN", () => {
    const d = decideVdotUpdate(
      input({ calibration: { finalVdot: 30, confidence: "high", insufficientData: false } }),
    );
    expect(d.newVdot).toBe(38 - AUTO_MAX_STEP_DOWN);
  });

  it("the down cap is more permissive than the up cap", () => {
    expect(AUTO_MAX_STEP_DOWN).toBeGreaterThan(AUTO_MAX_STEP_UP);
  });

  it("a delta inside the cap is applied in full", () => {
    const d = decideVdotUpdate(
      input({ calibration: { finalVdot: 40, confidence: "high", insufficientData: false } }),
    );
    expect(d.newVdot).toBe(40);
    expect(d.reason).not.toContain("begrenzt");
  });
});

describe("manual pin TTL", () => {
  const measured = { finalVdot: 42, confidence: "high" as const, insufficientData: false };
  const pinnedDaysAgo = (days: number) => new Date(NOW.getTime() - days * 86400000);

  it("blocks while the pin is fresh", () => {
    const d = decideVdotUpdate(
      input({
        vdotSource: VDOT_SOURCE_MANUAL,
        vdotSetAt: pinnedDaysAgo(MANUAL_PIN_TTL_DAYS - 1),
        calibration: measured,
      }),
    );
    expect(d.status).toBe("manual_pin_fresh");
    expect(d.reason).toContain("Tage");
  });

  it("releases once the pin is older than the TTL", () => {
    const d = decideVdotUpdate(
      input({
        vdotSource: VDOT_SOURCE_MANUAL,
        vdotSetAt: pinnedDaysAgo(MANUAL_PIN_TTL_DAYS + 1),
        calibration: measured,
      }),
    );
    expect(d.status).toBe("applied");
  });

  it("only 'manual' gets the TTL — engine and placeholder values do not", () => {
    for (const source of [VDOT_SOURCE_AUTO, "comeback_placeholder", null]) {
      const d = decideVdotUpdate(
        input({ vdotSource: source, vdotSetAt: pinnedDaysAgo(1), calibration: measured }),
      );
      expect(d.status).toBe("applied");
    }
  });

  it("a manual pin still blocks a DOWNWARD move — deliberate beats measured either way", () => {
    const d = decideVdotUpdate(
      input({
        vdotSource: VDOT_SOURCE_MANUAL,
        vdotSetAt: pinnedDaysAgo(2),
        calibration: { finalVdot: 34, confidence: "high", insufficientData: false },
      }),
    );
    expect(d.status).toBe("manual_pin_fresh");
  });
});

describe("pace-table range", () => {
  it("refuses to write below the table floor instead of snapping silently", () => {
    const d = decideVdotUpdate(
      input({
        currentVdot: VDOT_TABLE_MIN + 1,
        calibration: { finalVdot: 28, confidence: "high", insufficientData: false },
      }),
    );
    expect(d.status).toBe("out_of_table_range");
    expect(d.newVdot).toBeNull();
  });

  it("refuses to write above the contiguous band", () => {
    const d = decideVdotUpdate(
      input({
        currentVdot: VDOT_TABLE_MAX,
        calibration: { finalVdot: 56, confidence: "high", insufficientData: false },
        layoffActive: false,
      }),
    );
    expect(d.status).toBe("out_of_table_range");
  });

  it("every value inside the band resolves to its OWN table row — no silent snap", () => {
    // This is the invariant the range clamp exists to protect: within
    // [VDOT_TABLE_MIN, VDOT_TABLE_MAX] each value must have a distinct pace row.
    for (let v = VDOT_TABLE_MIN; v < VDOT_TABLE_MAX; v++) {
      expect(vdotToPaces(v).T).not.toBe(vdotToPaces(v + 1).T);
    }
  });

  it("documents the table hole the clamp guards against", () => {
    // 51..54 do not exist and snap to a neighbour; below 35 everything snaps to 35.
    // If someone ever fills these rows in, this test fails and the clamp can widen.
    expect(vdotToPaces(51).T).toBe(vdotToPaces(VDOT_TABLE_MAX).T);
    expect(vdotToPaces(30).T).toBe(vdotToPaces(VDOT_TABLE_MIN).T);
  });
});

describe("housekeeping", () => {
  it("does not mutate its input", () => {
    const original = input({ calibration: { finalVdot: 44, confidence: "high", insufficientData: false } });
    const snapshot = JSON.stringify(original);
    decideVdotUpdate(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("reports the measured value even when it refuses to apply it", () => {
    const d = decideVdotUpdate(
      input({ layoffActive: true, calibration: { finalVdot: 43, confidence: "high", insufficientData: false } }),
    );
    expect(d.measuredVdot).toBe(43);
    expect(d.currentVdot).toBe(38);
  });
});
