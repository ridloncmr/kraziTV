/** Whether a value is a positive integer count, such as a byte or duration limit. */
export function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Whether a value is a zero-or-greater integer, such as a delay or offset. */
export function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Rejects a byte or duration limit that cannot be a positive integer count. */
export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!isPositiveSafeInteger(value)) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

/** Rejects a delay or grace period that cannot form a deterministic deadline. */
export function assertNonNegativeSafeInteger(
  value: number,
  name: string,
): void {
  if (!isNonNegativeSafeInteger(value)) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
