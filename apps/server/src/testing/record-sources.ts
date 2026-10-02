/** Returns an ID source producing `<prefix>-001`, `<prefix>-002`, ... in call order. */
export function sequentialIds(prefix: string): () => string {
  let nextId = 0;
  return () => `${prefix}-${String(++nextId).padStart(3, "0")}`;
}

/**
 * Returns a clock that reads each scripted time once, in order, then keeps
 * returning the last one, so tests can assert exact create and update times.
 */
export function scriptedClock(times: readonly number[]): () => number {
  const remaining = [...times];
  return () => (remaining.length > 1 ? remaining.shift()! : remaining[0]);
}
