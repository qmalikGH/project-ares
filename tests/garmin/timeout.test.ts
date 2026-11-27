// Sprint 3.4 (#28), Phase A2 — Garmin calls get a time limit.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeadline, GarminTimeoutError, withTimeout } from "@/lib/garmin/timeout";
import { classifyError } from "@/lib/garmin/sync";

afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("rejects a hanging call with a readable, classifiable error", async () => {
    vi.useFakeTimers();
    const hanging = new Promise<never>(() => {});
    const p = withTimeout(hanging, "sleep", 15_000);
    const assertion = expect(p).rejects.toBeInstanceOf(GarminTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    await expect(p).rejects.toThrow("Garmin timeout after 15000 ms: sleep");
    expect(classifyError("Garmin timeout after 15000 ms: sleep")).toBe("NETWORK");
  });

  it("passes a timely result through", async () => {
    await expect(withTimeout(Promise.resolve(42), "x")).resolves.toBe(42);
  });

  it("passes the call's own error through", async () => {
    await expect(withTimeout(Promise.reject(new Error("403")), "x")).rejects.toThrow("403");
  });
});

describe("createDeadline", () => {
  it("counts down from the budget", () => {
    let t = 1_000;
    const d = createDeadline(50_000, () => t);
    expect(d.remainingMs()).toBe(50_000);
    expect(d.isNear(10_000)).toBe(false);
    t += 41_000;
    expect(d.remainingMs()).toBe(9_000);
    expect(d.isNear(10_000)).toBe(true);
    t += 60_000;
    expect(d.remainingMs()).toBe(0);
  });
});
