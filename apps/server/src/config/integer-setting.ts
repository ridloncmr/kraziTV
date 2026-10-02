/**
 * Parses one positive integer environment setting, returning the fallback when
 * it is unset. Accepts only plain decimal digits so values like "1e3" or "2.5"
 * are never coerced, and names the setting in the error so a typo fails fast.
 */
export function parseIntegerSetting(
  name: string,
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(
      `${name} must be an integer from 1 through ${max}; received "${value}"`,
    );
  }
  return parsed;
}
