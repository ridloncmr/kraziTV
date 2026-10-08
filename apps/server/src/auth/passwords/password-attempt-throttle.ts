const FREE_FAILURES = 5;
const FIRST_WAIT_MS = 1000;
const MAX_WAIT_MS = 5 * 60 * 1000;

type Admission = { admitted: true } | { admitted: false; retryAfterMs: number };

/**
 * Slows password guessing for the one account: after five consecutive
 * failures each further attempt waits, doubling from 1 second to 5 minutes.
 * In memory only, so a restart forgives every failure; one counter serves
 * every password check, because there is one account.
 *
 * An admitted attempt counts as a failure at once, before its slow check
 * finishes, and a success undoes it. Otherwise many attempts sent together
 * would all pass the check while none had failed yet.
 */
export class PasswordAttemptThrottle {
  #failures = 0;
  #waitUntil = 0;

  /**
   * Admits an attempt at `now` and reserves its failure, or refuses it with
   * the remaining wait. A refused attempt is not counted, so retrying early
   * never lengthens the wait.
   */
  admit(now: number): Admission {
    if (now < this.#waitUntil) {
      return { admitted: false, retryAfterMs: this.#waitUntil - now };
    }
    this.#failures += 1;
    if (this.#failures >= FREE_FAILURES) {
      this.#waitUntil = now + waitAfter(this.#failures);
    }
    return { admitted: true };
  }

  /** Forgives every failure once the right password is given. */
  succeed(): void {
    this.#failures = 0;
    this.#waitUntil = 0;
  }
}

/** The wait after the `failures`-th consecutive failure, from the fifth on. */
function waitAfter(failures: number): number {
  return Math.min(FIRST_WAIT_MS * 2 ** (failures - FREE_FAILURES), MAX_WAIT_MS);
}
