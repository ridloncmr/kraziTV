import { parseIntegerSetting } from "./integer-setting.js";

interface TunerConfig {
  deviceId: string;
  tunerCount: number;
}

// "KZTV" in ASCII hex. Fixed so Plex keeps recognizing the same tuner across
// restarts; a second install on one Plex server overrides it.
const DEFAULT_DEVICE_ID = "4B5A5456";
const DEFAULT_TUNER_COUNT = 2;
// A generous bound; real HDHomeRun devices advertise single digits.
const MAX_TUNER_COUNT = 64;

/**
 * Resolves the tuner identity Plex sees once at startup. The device ID is
 * uppercased so a case-only change never makes Plex treat it as a new tuner.
 * The tuner count caps how many distinct channels Plex streams at once.
 */
export function parseTunerConfig(
  env: Readonly<Record<string, string | undefined>>,
): TunerConfig {
  return {
    deviceId: parseDeviceId(env.KRAZITV_DEVICE_ID),
    tunerCount: parseIntegerSetting(
      "KRAZITV_TUNER_COUNT",
      env.KRAZITV_TUNER_COUNT,
      DEFAULT_TUNER_COUNT,
      MAX_TUNER_COUNT,
    ),
  };
}

// Accepts exactly 8 hex digits, the HDHomeRun device ID shape.
function parseDeviceId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_DEVICE_ID;
  }
  if (!/^[0-9a-f]{8}$/i.test(trimmed)) {
    throw new Error(
      `KRAZITV_DEVICE_ID must be 8 hexadecimal digits; received "${value}"`,
    );
  }
  return trimmed.toUpperCase();
}
