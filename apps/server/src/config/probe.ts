import { parseIntegerSetting } from "./integer-setting.js";

interface ProbeConfig {
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
