/**
 * Tracks when a promise settles either way, readable synchronously between
 * awaits. It handles the rejection itself, so a test can hold a promise it
 * expects to fail without a chained `finally` leaking that failure as an
 * unhandled rejection.
 */
export function trackSettlement(promise: Promise<unknown>): {
  readonly settled: boolean;
} {
  const flag = { settled: false };
  const mark = (): void => {
    flag.settled = true;
  };
  promise.then(mark, mark);
  return flag;
}
