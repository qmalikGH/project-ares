// Sprint 2.4 — the run-volume gate, in particular the "no data is not green"
// rule. Pure helper, no DB.
import { describe, it, expect } from "vitest";

import {
  deriveVolumeGate,
  type VolumeGateInput,
} from "@/lib/db/queries/regenerate-plans-helpers";

const BASE: VolumeGateInput = {
  recentShin: 0,
  completedInWindow: 4,
  latestRhr: 46,
  baselineRhr: 44,
};

describe("deriveVolumeGate — shin signal", () => {
  it("calm shin with recent training progresses", () => {
    expect(deriveVolumeGate(BASE).gate).toBe("progress");
    expect(deriveVolumeGate({ ...BASE, recentShin: 2 }).gate).toBe("progress");
  });
  it("NRS 3 holds", () => {
    expect(deriveVolumeGate({ ...BASE, recentShin: 3 }).gate).toBe("hold");
  });
  it("NRS ≥4 regresses", () => {
    expect(deriveVolumeGate({ ...BASE, recentShin: 4 }).gate).toBe("regress");
    expect(deriveVolumeGate({ ...BASE, recentShin: 7 }).gate).toBe("regress");
  });
});

describe("deriveVolumeGate — absence of evidence (the Sprint 2.4 fix)", () => {
  it("no completed session in the window never progresses", () => {
    // This is the comeback case: an athlete who stopped BECAUSE of shin pain
    // files no pain reports while not running. Pre-2.4 this returned progress.
    const decision = deriveVolumeGate({
      recentShin: null,
      completedInWindow: 0,
      latestRhr: null,
      baselineRhr: 44,
    });
    expect(decision.gate).toBe("hold");
    expect(decision.reason).toContain("unknown");
  });

  it("a reported flare still outranks 'unknown' — worst signal wins", () => {
    expect(
      deriveVolumeGate({ ...BASE, recentShin: 5, completedInWindow: 0 }).gate,
    ).toBe("regress");
  });

  it("training happened but no shin was reported → still progresses", () => {
    // Not the same thing as no training at all: the athlete ran and filed
    // nothing, which the app has always treated as no pain.
    expect(
      deriveVolumeGate({ ...BASE, recentShin: null, completedInWindow: 3 }).gate,
    ).toBe("progress");
  });
});

describe("deriveVolumeGate — resting HR downgrade", () => {
  it("RHR more than 5 over baseline downgrades progress to hold", () => {
    // baseline 44 → 49 is the last still-acceptable value.
    expect(deriveVolumeGate({ ...BASE, latestRhr: 49 }).gate).toBe("progress");
    expect(deriveVolumeGate({ ...BASE, latestRhr: 50 }).gate).toBe("hold");
  });

  it("missing RHR does not by itself hold (the watch may simply be off)", () => {
    expect(deriveVolumeGate({ ...BASE, latestRhr: null }).gate).toBe("progress");
  });

  it("missing baseline cannot trigger a downgrade", () => {
    expect(deriveVolumeGate({ ...BASE, latestRhr: 80, baselineRhr: null }).gate).toBe(
      "progress",
    );
  });

  it("RHR never upgrades a shin-driven hold", () => {
    expect(deriveVolumeGate({ ...BASE, recentShin: 3, latestRhr: 40 }).gate).toBe("hold");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 2.9 — auto-imported sessions are not evidence of wellbeing
// ═══════════════════════════════════════════════════════════════════════════

describe("deriveVolumeGate — attested vs merely completed", () => {
  // This is the regression guard for the whole auto-import feature. Without it,
  // a nightly import flips the gate to "progress, shin calm" on the strength of
  // sessions nobody rated — the exact Sprint 2.4 bug, through a new door.
  it("holds when sessions were completed but none were rated", () => {
    const d = deriveVolumeGate({
      recentShin: null,
      completedInWindow: 4,
      attestedInWindow: 0,
      latestRhr: 48,
      baselineRhr: 50,
    });
    expect(d.gate).toBe("hold");
    expect(d.reason).toContain("none rated");
  });

  it("progresses once at least one session carries a shin report", () => {
    const d = deriveVolumeGate({
      recentShin: 1,
      completedInWindow: 4,
      attestedInWindow: 1,
      latestRhr: 48,
      baselineRhr: 50,
    });
    expect(d.gate).toBe("progress");
  });

  it("keeps the original message when nothing was completed at all", () => {
    const d = deriveVolumeGate({
      recentShin: null,
      completedInWindow: 0,
      attestedInWindow: 0,
      latestRhr: 48,
      baselineRhr: 50,
    });
    expect(d.gate).toBe("hold");
    expect(d.reason).toContain("no completed session");
  });

  it("defaults to the old behaviour when the caller omits the new counter", () => {
    const d = deriveVolumeGate({
      recentShin: 1,
      completedInWindow: 2,
      latestRhr: 48,
      baselineRhr: 50,
    });
    expect(d.gate).toBe("progress");
  });

  it("a reported shin still outranks everything", () => {
    const d = deriveVolumeGate({
      recentShin: 5,
      completedInWindow: 4,
      attestedInWindow: 0,
      latestRhr: 48,
      baselineRhr: 50,
    });
    expect(d.gate).toBe("regress");
  });
});
