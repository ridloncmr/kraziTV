export interface ProbeConfig {
  ffprobePath: string;
  timeoutMs: number;
  /** Maximum ffprobe children alive at once across every scan in the process. */
  concurrency: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 32;

/**
 * Resolves ffprobe settings once at startup so invalid operator configuration
 * fails fast instead of surfacing as a confusing mid-scan failure.
 */
export function parseProbeConfig(
  env: Readonly<Record<string, string | undefined>>,
): ProbeConfig {
  return {
    ffprobePath: env.FFPROBE_PATH?.trim() || "ffprobe",
    timeoutMs: parseIntegerSetting(
      "FFPROBE_TIMEOUT_MS",
      env.FFPROBE_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      Number.MAX_SAFE_INTEGER,
    ),
    concurrency: parseIntegerSetting(
      "FFPROBE_CONCURRENCY",
      env.FFPROBE_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      MAX_CONCURRENCY,
    ),
  };
}

// Accepts only plain decimal digits so values like "1e3" or "2.5" are never coerced.
function parseIntegerSetting(
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
