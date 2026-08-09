// Sprint 2.4 — layoff detection + comeback ramp. Pure module, no DB.
//
// The property that matters most: the anchor is derived, not stored. It must
// stay put once training resumes, or the ramp resets to week 1 every time the
// athlete completes a session and he never leaves week 1.
import { describe, it, expect } from "vitest";

import {
  detectLayoff,
  comebackWeekFor,
  rampFor,
  startOfIsoWeek,
  LAYOFF_MIN_GAP_DAYS,
  COMEBACK_RAMP_WEEKS,
} from "@/lib/coach-engine/comeback";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("startOfIsoWeek", () => {
  it("maps a Monday to itself", () => {
    expect(startOfIsoWeek(d("2026-08-10")).toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
  it("maps Sunday back to the Monday that opened the week", () => {
    expect(startOfIsoWeek(d("2026-08-09")).toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
  it("maps mid-week days back to their Monday", () => {
    expect(startOfIsoWeek(d("2026-08-13")).toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});

describe("detectLayoff — open layoff (training has not resumed)", () => {
  // Q's real shape on 2026-08-09: last completed session 2026-06-09.
  const history = [d("2026-06-04"), d("2026-06-05"), d("2026-06-06"), d("2026-06-08"), d("2026-06-09")];

  it("detects the 61-day gap and anchors on the week about to be planned", () => {
    const state = detectLayoff(history, d("2026-08-09"), d("2026-08-10"));
    expect(state.active).toBe(true);
    expect(state.gapDays).toBe(61);
    expect(state.restartWeekStart?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("ramps the three planned weeks 1 → 2 → 3, then stops", () => {
    const { restartWeekStart } = detectLayoff(history, d("2026-08-09"), d("2026-08-10"));
    expect(comebackWeekFor(d("2026-08-10"), restartWeekStart)).toBe(1);
    expect(comebackWeekFor(d("2026-08-17"), restartWeekStart)).toBe(2);
    expect(comebackWeekFor(d("2026-08-24"), restartWeekStart)).toBe(3);
    expect(comebackWeekFor(d("2026-08-31"), restartWeekStart)).toBeNull();
  });

  it("falls back to no anchor when the caller has no upcoming week", () => {
    const state = detectLayoff(history, d("2026-08-09"), null);
    expect(state.active).toBe(true);
    expect(state.restartWeekStart).toBeNull();
    expect(comebackWeekFor(d("2026-08-10"), state.restartWeekStart)).toBeNull();
  });
});

describe("detectLayoff — closed layoff (anchor must not drift)", () => {
  const preLayoff = [d("2026-06-08"), d("2026-06-09")];

  it("anchors on the ISO week of the first session back, not the session date", () => {
    // Training resumed on Tuesday 2026-08-11, not on the Monday.
    const state = detectLayoff([...preLayoff, d("2026-08-11")], d("2026-08-12"), d("2026-08-10"));
    expect(state.active).toBe(true);
    expect(state.restartWeekStart?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    // …so the following plan week is ramp week 2, not week 1 all over again.
    expect(comebackWeekFor(d("2026-08-17"), state.restartWeekStart)).toBe(2);
  });

  it("stays on the same anchor as more sessions get completed", () => {
    const anchorAfterOne = detectLayoff([...preLayoff, d("2026-08-11")], d("2026-08-12"), d("2026-08-17"));
    const anchorAfterMany = detectLayoff(
      [...preLayoff, d("2026-08-11"), d("2026-08-13"), d("2026-08-15"), d("2026-08-17")],
      d("2026-08-18"),
      d("2026-08-24"),
    );
    expect(anchorAfterMany.restartWeekStart?.toISOString()).toBe(
      anchorAfterOne.restartWeekStart?.toISOString(),
    );
  });

  it("expires on its own once the ramp window has passed", () => {
    const state = detectLayoff([...preLayoff, d("2026-08-11")], d("2026-09-01"), null);
    expect(comebackWeekFor(d("2026-08-31"), state.restartWeekStart)).toBeNull();
  });
});

describe("detectLayoff — when it must NOT fire", () => {
  it("a normal training rhythm is not a layoff", () => {
    const history = [d("2026-08-01"), d("2026-08-03"), d("2026-08-05"), d("2026-08-08")];
    expect(detectLayoff(history, d("2026-08-09"), d("2026-08-10")).active).toBe(false);
  });

  it("a gap one day short of the threshold is not a layoff", () => {
    const last = d("2026-08-09");
    const justUnder = new Date(last.getTime() - (LAYOFF_MIN_GAP_DAYS - 1) * 86400000);
    expect(detectLayoff([justUnder, last], last, d("2026-08-10")).active).toBe(false);

    const justOver = new Date(last.getTime() - LAYOFF_MIN_GAP_DAYS * 86400000);
    expect(detectLayoff([justOver, last], last, d("2026-08-10")).active).toBe(true);
  });

  it("an athlete with no completed sessions is onboarding, not coming back", () => {
    // Otherwise a brand-new user's first block would silently start at 55% volume.
    expect(detectLayoff([], d("2026-08-09"), d("2026-08-10")).active).toBe(false);
  });

  it("ignores past weeks and out-of-window weeks", () => {
    const anchor = d("2026-08-10");
    expect(comebackWeekFor(d("2026-08-03"), anchor)).toBeNull();
    expect(comebackWeekFor(d("2026-08-10"), null)).toBeNull();
  });
});

describe("ramp shape", () => {
  it("run volume climbs 0.55 → 0.70 → 0.85 and quality returns only in week 3", () => {
    expect(rampFor(1)).toMatchObject({ runVolumeFactor: 0.55, suppressQuality: true });
    expect(rampFor(2)).toMatchObject({ runVolumeFactor: 0.7, suppressQuality: true });
    expect(rampFor(3)).toMatchObject({ runVolumeFactor: 0.85, suppressQuality: false });
  });

  it("strength load recovers faster than run volume in every week", () => {
    // science_doc 1.4: myonuclei persist → force returns quickly; tendon/bone
    // is the slow system, so the run brake must always be the harder one.
    for (let w = 1; w <= COMEBACK_RAMP_WEEKS; w++) {
      const r = rampFor(w as 1 | 2 | 3);
      expect(r.strengthLoadFactor).toBeGreaterThan(r.runVolumeFactor);
    }
  });

  it("every factor is a genuine reduction that never exceeds normal", () => {
    for (let w = 1; w <= COMEBACK_RAMP_WEEKS; w++) {
      const r = rampFor(w as 1 | 2 | 3);
      expect(r.runVolumeFactor).toBeGreaterThan(0);
      expect(r.runVolumeFactor).toBeLessThanOrEqual(1);
      expect(r.strengthLoadFactor).toBeLessThanOrEqual(1);
      expect(r.strengthSetFactor).toBeLessThanOrEqual(1);
    }
  });
});
