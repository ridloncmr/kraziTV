import { describe, expect, it } from "vitest";

import { PasswordAttemptThrottle } from "./password-attempt-throttle.js";

const T = 1_700_000_000_000;

/** Admits and fails `count` attempts at `now`, as wrong passwords would. */
function fail(throttle: PasswordAttemptThrottle, now: number, count: number) {
  for (let i = 0; i < count; i += 1) {
    expect(throttle.admit(now)).toEqual({ admitted: true });
  }
}

describe("PasswordAttemptThrottle", () => {
  it("admits five consecutive failures, then asks for a 1-second wait", () => {
    const throttle = new PasswordAttemptThrottle();
    fail(throttle, T, 5);

    expect(throttle.admit(T)).toEqual({ admitted: false, retryAfterMs: 1000 });
    expect(throttle.admit(T + 400)).toEqual({
      admitted: false,
      retryAfterMs: 600,
    });
  });

  it("does not count a refused attempt as a failure", () => {
    const throttle = new PasswordAttemptThrottle();
    fail(throttle, T, 5);
    for (let i = 0; i < 10; i += 1) throttle.admit(T + 500);

    fail(throttle, T + 1000, 1);
    expect(throttle.admit(T + 1000)).toEqual({
      admitted: false,
      retryAfterMs: 2000,
    });
  });

  it("doubles the wait after each further failure and caps it at 5 minutes", () => {
    const throttle = new PasswordAttemptThrottle();
    fail(throttle, T, 5);
    let now = T;
    const waits: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const refusal = throttle.admit(now);
      if (refusal.admitted) throw new Error("expected a wait");
      waits.push(refusal.retryAfterMs);
      now += refusal.retryAfterMs;
      fail(throttle, now, 1);
    }

    expect(waits).toEqual([
      1000, 2000, 4000, 8000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000,
      300_000,
    ]);
  });

  it("counts an admitted attempt before its check finishes, so parallel attempts cannot exceed the limit", () => {
    const throttle = new PasswordAttemptThrottle();

    // Ten attempts arrive together; none has finished its password check.
    const admissions = Array.from({ length: 10 }, () => throttle.admit(T));

    expect(admissions.filter((a) => a.admitted)).toHaveLength(5);
  });

  it("resets after a success, so the next failures start over", () => {
    const throttle = new PasswordAttemptThrottle();
    fail(throttle, T, 5);
    fail(throttle, T + 1000, 1);

    throttle.succeed();

    fail(throttle, T + 1000, 5);
    expect(throttle.admit(T + 1000)).toEqual({
      admitted: false,
      retryAfterMs: 1000,
    });
  });
});
