/** Rejects a byte or duration limit that cannot be a positive integer count. */
export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

/** Rejects a delay or grace period that cannot form a deterministic deadline. */
export function assertNonNegativeSafeInteger(
  value: number,
  name: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
