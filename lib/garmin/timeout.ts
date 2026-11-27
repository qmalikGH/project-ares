// Sprint 3.4 (#28, Phase A2): every Garmin call gets a time limit.
//
// garmin-connect builds its axios instance without a `timeout`, so a request
// that never answers waits forever. Inside a cron with `maxDuration = 60` that
// means Vercel kills the function mid-run: no log row, no error in the
// response, nothing that says which call hung. A rejected promise with a
// readable message turns that into an ordinary, logged error.
//
// The underlying request is not aborted (the library exposes no signal); it is
// simply no longer awaited. classifyError() buckets the message as NETWORK.

export const GARMIN_CALL_TIMEOUT_MS = 15_000;

export class GarminTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Garmin timeout after ${ms} ms: ${label}`);
    this.name = "GarminTimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number = GARMIN_CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GarminTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * A wall-clock budget for one cron invocation. Work that would start after the
 * deadline is skipped (and reported) instead of being cut off mid-write when
 * the platform kills the function.
 */
export interface Deadline {
  /** Milliseconds left; never negative. */
  remainingMs(): number;
  /** True when less than `reserveMs` is left. */
  isNear(reserveMs?: number): boolean;
}

export function createDeadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const end = now() + budgetMs;
  return {
    remainingMs: () => Math.max(0, end - now()),
    isNear: (reserveMs = 0) => end - now() <= reserveMs,
  };
}
