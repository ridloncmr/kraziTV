declare const canonicalChannelNumber: unique symbol;

/**
 * A canonical channel number, such as `69` or `69.1`. Branded so the compiler
 * only accepts values that came through `parseChannelNumber`.
 */
export type ChannelNumber = string & {
  readonly [canonicalChannelNumber]: true;
};

const CANONICAL_CHANNEL_NUMBER = /^[1-9][0-9]*(\.[1-9][0-9]*)?$/;

/**
 * Accepts only the canonical form, a positive major number with an optional
 * positive subchannel, so every layer stores and compares one spelling.
 * Returns `undefined` rather than normalizing non-canonical input.
 */
export function parseChannelNumber(input: string): ChannelNumber | undefined {
  return CANONICAL_CHANNEL_NUMBER.test(input)
    ? (input as ChannelNumber)
    : undefined;
}

/**
 * Orders canonical numbers by major number, then subchannel, with no
 * subchannel first. Compares digit strings rather than parsed numbers so
 * majors beyond safe integer precision still order exactly.
 */
export function compareChannelNumbers(
  left: ChannelNumber,
  right: ChannelNumber,
): number {
  const [leftMajor, leftSubchannel] = left.split(".");
  const [rightMajor, rightSubchannel] = right.split(".");

  return (
    compareDigits(leftMajor, rightMajor) ||
    compareDigits(leftSubchannel ?? "", rightSubchannel ?? "")
  );
}

/** Compares digit strings without leading zeroes; the empty string sorts first. */
function compareDigits(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
