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

  const origin = toHttpOrigin(trimmed);
  if (origin === undefined) {
    throw new Error(
      `PUBLIC_BASE_URL must be an absolute http: or https: URL with no credentials, path, query, or fragment; received "${value}"`,
    );
  }
  // The origin drops the trailing slash, so paths append with no double slash.
  return origin;
}

/**
 * Normalizes a configured value that must name exactly one http(s) origin,
 * or returns undefined when it names anything else: a path, query, fragment,
 * credentials, another scheme, or no URL at all.
 */
function toHttpOrigin(value: string): string | undefined {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (
    url === null ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return undefined;
  }
  return url.origin;
}

/**
 * Parses the browser origins allowed to call the API with credentials,
 * normalized so they compare equal to a request's `Origin`. A wildcard or
 * `null` would let any site act with the session cookie, so every entry must
 * be one http(s) origin. Returns undefined for an empty setting so the server
 * keeps its local Web UI default.
 */
export function parseCorsOrigins(
  value: string | undefined,
): string[] | undefined {
  const entries = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!entries?.length) return undefined;

  return entries.map((entry) => {
    const origin = toHttpOrigin(entry);
    if (origin === undefined) {
      throw new Error(
        `CORS_ORIGINS entries must be absolute http: or https: origins with no credentials, path, query, or fragment; received "${entry}"`,
      );
    }
    return origin;
  });
}
