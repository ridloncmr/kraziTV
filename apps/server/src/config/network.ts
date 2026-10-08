import { parseIntegerSetting } from "./integer-setting.js";

interface ListenConfig {
  host: string;
  port: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;

/**
 * Resolves the bind address once at startup so a typo such as PORT=abc fails
 * with the setting's name instead of a NaN error from inside Fastify.
 */
export function parseListenConfig(
  env: Readonly<Record<string, string | undefined>>,
): ListenConfig {
  return {
    host: env.HOST?.trim() || DEFAULT_HOST,
    // The 1 minimum rejects 0, so the server never binds a random port.
    port: parseIntegerSetting("PORT", env.PORT, DEFAULT_PORT, MAX_PORT),
  };
}

/**
 * Resolves the origin Plex reaches kraziTV at, which every absolute tuner and
 * stream URL is built on. Request Host headers are never trusted for this, so
 * a non-local Plex needs the setting; the default follows PORT on loopback.
 */
export function parsePublicBaseUrl(
  value: string | undefined,
  port: number,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return `http://${DEFAULT_HOST}:${port}`;
  }

  const url = URL.canParse(trimmed) ? new URL(trimmed) : null;
  if (
    url === null ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `PUBLIC_BASE_URL must be an absolute http: or https: URL with no credentials, path, query, or fragment; received "${value}"`,
    );
  }
  // The origin drops the trailing slash, so paths append with no double slash.
  return url.origin;
}

/** Returns undefined for an empty setting so the server keeps its local Web UI default. */
export function parseCorsOrigins(
  value: string | undefined,
): string[] | undefined {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : undefined;
}
