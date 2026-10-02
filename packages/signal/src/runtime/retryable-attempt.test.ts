import { describe, expect, it } from "vitest";

import { Deferred } from "../testing/deferred.js";
import { RetryableAttempt } from "./retryable-attempt.js";

describe("RetryableAttempt", () => {
  it("shares one in-flight attempt between concurrent callers", async () => {
    const attempt = new RetryableAttempt();
    const gate = new Deferred<void>();
    let starts = 0;
    const start = () => {
      starts += 1;
      return gate.promise;
    };

    const first = attempt.run(start);
    const second = attempt.run(start);
    gate.resolve();
    await Promise.all([first, second]);

    expect(second).toBe(first);
    expect(starts).toBe(1);
  });

  it("keeps a successful attempt so later calls do not start another", async () => {
    const attempt = new RetryableAttempt();
    let starts = 0;
    const start = async () => {
      starts += 1;
    };

    await attempt.run(start);
    await attempt.run(start);

    expect(starts).toBe(1);
  });

  it("releases a failed attempt so the next call retries", async () => {
    const attempt = new RetryableAttempt();
    const failure = new Error("cleanup failed");

    await expect(attempt.run(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    await expect(attempt.run(async () => undefined)).resolves.toBeUndefined();
  });
});
